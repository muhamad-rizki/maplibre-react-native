require('./autogenHelpers/globals');

const fs = require('fs');
const path = require('path');

const ejs = require('ejs');

const {execSync} = require('child_process');

const prettier = require('prettier');
const prettierrc = require('../.prettierrc.js');

const styleSpecJSON = require('../style-spec/v8.json');

const DocJSONBuilder = require('./autogenHelpers/DocJSONBuilder');
const MarkdownBuilder = require('./autogenHelpers/MarkdownBuilder');

function readIosVersion() {
  const podspecPath = path.join(
    __dirname,
    '..',
    'maplibre-react-native.podspec',
  );
  const lines = fs.readFileSync(podspecPath, 'utf8').split('\n');
  const maplibreLineRegex = /^\s+version:\s*"(\d+\.\d+\.\d+)"$/;
  const maplibreLine = lines.filter(i => maplibreLineRegex.exec(i))[0];
  return `${maplibreLineRegex.exec(maplibreLine)[1]}.0`;
}

function readAndroidVersion() {
  const buildGradlePath = path.join(
    __dirname,
    '..',
    'android',
    'rctmgl',
    'build.gradle',
  );
  const lines = fs.readFileSync(buildGradlePath, 'utf8').split('\n');
  const maplibreLineRegex = /^\s+implementation\s+"org.maplibre.gl:android-sdk:(\d+\.\d+\.\d+)"$/;
  const maplibreLine = lines.filter(i => maplibreLineRegex.exec(i))[0];
  return maplibreLineRegex.exec(maplibreLine)[1];
}

if (!styleSpecJSON) {
  console.log(
    'Could not find style spec, try running "yarn run fetch:style:spec"',
  );
  process.exit(1);
}

const layers = [];
const androidVersion = readAndroidVersion();
const iosVersion = readIosVersion();

const TMPL_PATH = path.join(__dirname, 'templates');

const outputToExample = false;
const OUTPUT_EXAMPLE_PREFIX = [
  '..',
  'example',
  'node_modules',
  '@maplibre',
  'maplibre-react-native',
];
const OUTPUT_PREFIX = outputToExample ? OUTPUT_EXAMPLE_PREFIX : ['..'];

const IOS_OUTPUT_PATH = path.join(__dirname, ...OUTPUT_PREFIX, 'ios', 'RCTMGL');
const ANDROID_OUTPUT_PATH = path.join(
  __dirname,
  ...OUTPUT_PREFIX,
  'android',
  'rctmgl',
  'src',
  'main',
  'java',
  'com',
  'mapbox',
  'rctmgl',
  'components',
  'styles',
);
const JS_OUTPUT_PATH = path.join(
  __dirname,
  ...OUTPUT_PREFIX,
  'javascript',
  'utils',
);

getSupportedLayers(Object.keys(styleSpecJSON.layer.type.values)).forEach(
  layerName => {
    layers.push({
      name: layerName,
      properties: getPropertiesForLayer(layerName),
    });
  },
);

// add light as a layer
layers.push({name: 'light', properties: getPropertiesForLight()});

function getPropertiesForLight() {
  const lightAttributes = styleSpecJSON.light;

  return getSupportedProperties(lightAttributes).map(attrName => {
    return Object.assign({}, buildProperties(lightAttributes, attrName), {
      allowedFunctionTypes: [],
    });
  });
}

function getPropertiesForLayer(layerName) {
  const paintAttributes = styleSpecJSON[`paint_${layerName}`];
  const layoutAttributes = styleSpecJSON[`layout_${layerName}`];

  const paintProps = getSupportedProperties(paintAttributes).map(attrName => {
    const prop = buildProperties(paintAttributes, attrName);

    // overrides
    if (['line-width'].includes(attrName)) {
      prop.allowedFunctionTypes = ['camera'];
    }

    return prop;
  });

  const layoutProps = getSupportedProperties(layoutAttributes).map(attrName => {
    const prop = buildProperties(layoutAttributes, attrName);

    // overrides
    if (
      [
        'line-join',
        'text-max-width',
        'text-letter-spacing',
        'text-anchor',
        'text-justify',
        'text-font',
      ].includes(attrName)
    ) {
      prop.allowedFunctionTypes = ['camera'];
    }

    return prop;
  });

  return layoutProps.concat(paintProps);
}

function getSupportedLayers(layerNames) {
  const layerMap = styleSpecJSON.layer.type.values;

  const supportedLayers = [];
  for (const layerName of layerNames) {
    const layer = layerMap[layerName];
    const support = getAttributeSupport(layer['sdk-support']);

    if (support.basic.android && support.basic.ios) {
      supportedLayers.push(layerName);
    }
  }

  return supportedLayers;
}

function getSupportedProperties(attributes) {
  return Object.keys(attributes).filter(attrName =>
    isAttrSupported(attributes[attrName]),
  );
}

function buildProperties(attributes, attrName) {
  return {
    name: camelCase(attrName),
    doc: {
      default: attributes[attrName].default,
      minimum: attributes[attrName].minimum,
      maximum: attributes[attrName].maximum,
      units: attributes[attrName].units,
      description: formatDescription(attributes[attrName].doc),
      requires: getRequires(attributes[attrName].requires),
      disabledBy: getDisables(attributes[attrName].requires),
      values: attributes[attrName].values,
    },
    type: attributes[attrName].type,
    value: attributes[attrName].value,
    image: isImage(attrName),
    translate: isTranslate(attrName),
    transition: attributes[attrName].transition,
    expression: attributes[attrName].expression,
    expressionSupported:
      Object.keys(attributes[attrName].expression || {}).length > 0,
    support: getAttributeSupport(attributes[attrName]['sdk-support']),
    allowedFunctionTypes: getAllowedFunctionTypes(attributes[attrName]),
  };
}

function formatDescription(description) {
  const words = description.split(' ');

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (word.includes('-')) {
      words[i] = camelCase(word);
    }
  }

  return words.join(' ');
}

function getRequires(requiredItems) {
  const items = [];

  if (!requiredItems) {
    return items;
  }

  for (const item of requiredItems) {
    if (typeof item === 'string') {
      items.push(camelCase(item, '-'));
    }
  }

  return items;
}

function getDisables(disabledItems) {
  const items = [];

  if (!disabledItems) {
    return items;
  }

  for (const item of disabledItems) {
    if (item['!']) {
      items.push(camelCase(item['!'], '-'));
    }
  }

  return items;
}

function isImage(attrName) {
  return (
    attrName.toLowerCase().indexOf('pattern') !== -1 ||
    attrName.toLowerCase().indexOf('image') !== -1
  );
}

function isTranslate(attrName) {
  return attrName.toLowerCase().indexOf('translate') !== -1;
}

function isAttrSupported(attr) {
  const support = getAttributeSupport(attr['sdk-support']);
  if (attr.private) {
    return false
  }
  return support.basic.android && support.basic.ios;
}

function getAttributeSupport(sdkSupport) {
  const support = {
    basic: {android: false, ios: false},
    data: {android: false, ios: false},
  };

  const basicSupport = sdkSupport && sdkSupport['basic functionality'];
  if (basicSupport && basicSupport.android) {
    support.basic.android = isVersionGTE(androidVersion, basicSupport.android);
  }
  if (basicSupport && basicSupport.ios) {
    support.basic.ios = isVersionGTE(iosVersion, basicSupport.ios);
  }

  const dataDrivenSupport = sdkSupport && sdkSupport['data-driven styling'];
  if (dataDrivenSupport && dataDrivenSupport.android) {
    support.data.android = isVersionGTE(
      androidVersion,
      dataDrivenSupport.android,
    );
  }
  if (dataDrivenSupport && dataDrivenSupport.ios) {
    support.data.ios = isVersionGTE(iosVersion, dataDrivenSupport.ios);
  }

  if (support.data.ios !== true || support.data.android !== true) {
    support.data.ios = false;
    support.data.android = false;
  }

  return support;
}

function isVersionGTE(version, otherVersion) {
  const v = +version
    .split('.')
    .map(i => String(i).padStart(3, '0'))
    .join('');
  const ov = +otherVersion
    .split('.')
    .map(i => String(i).padStart(3, '0'))
    .join('');
  return v >= ov;
}

function getAllowedFunctionTypes(paintAttr) {
  const allowedFunctionTypes = [];

  if (paintAttr['zoom-function']) {
    allowedFunctionTypes.push('camera');
  }

  if (paintAttr['property-function']) {
    allowedFunctionTypes.push('source');
    allowedFunctionTypes.push('composite');
  }

  return allowedFunctionTypes;
}

async function generate() {
  const templateMappings = [
    {
      input: path.join(TMPL_PATH, 'RCTMGLStyle.h.ejs'),
      output: path.join(IOS_OUTPUT_PATH, 'RCTMGLStyle.h'),
    },
    /*{
      input: path.join(TMPL_PATH, 'index.d.ts.ejs'),
      output: path.join(IOS_OUTPUT_PATH, 'index.d.ts'),
    },*/
    {
      input: path.join(TMPL_PATH, 'MaplibreStyles.ts.ejs'),
      output: path.join(JS_OUTPUT_PATH, 'MaplibreStyles.d.ts'), 
    },
    {
      input: path.join(TMPL_PATH, 'RCTMGLStyle.m.ejs'),
      output: path.join(IOS_OUTPUT_PATH, 'RCTMGLStyle.m'),
    },
    {
      input: path.join(TMPL_PATH, 'RCTMGLStyleFactory.java.ejs'),
      output: path.join(ANDROID_OUTPUT_PATH, 'RCTMGLStyleFactory.java'),
    },
    {
      input: path.join(TMPL_PATH, 'styleMap.ts.ejs'),
      output: path.join(JS_OUTPUT_PATH, 'styleMap.ts'),
    },
  ];
  const outputPaths = templateMappings.map(m => m.output);

  // autogenerate code
  templateMappings.forEach(({input, output}) => {
    const filename = output.split('/').pop();
    console.log(`Generating ${filename}`);
    const tmpl = ejs.compile(fs.readFileSync(input, 'utf8'), {strict: true});
    let results = tmpl({layers});
    if (filename.endsWith('ts')) {
      results = prettier.format(results, { ...prettierrc, filepath: filename});
    }
    fs.writeFileSync(output, results);
  });

  // autogenerate docs
  const docBuilder = new DocJSONBuilder(layers);
  const markdownBuilder = new MarkdownBuilder();
  await docBuilder.generate();
  await markdownBuilder.generate();

  // Check if any generated files changed
  try {
    execSync(`git diff --exit-code docs/ ${outputPaths.join(' ')}`);
  } catch (error) {
    console.error(
      '\n\nThere are unstaged changes in the generated code. ' +
        'Please add them to your commit.\n' +
        'If you would really like to exclude them, run "git commit -n" to skip.\n\n',
    );
    process.exit(1);
  }
}

generate();
