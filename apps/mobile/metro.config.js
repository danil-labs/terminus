const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);
// `@terminus/*` are linked from ../../packages; Metro only sees files it watches.
config.watchFolders = [path.resolve(__dirname, "../../packages")];
module.exports = config;
