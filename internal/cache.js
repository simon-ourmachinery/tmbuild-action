const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const cache = require('@actions/cache');
const utils = require('./utils');
const os = require('os');

async function set(toolPath, toolname, cacheVersion) {
    const key = `${toolname}-${os.platform()}-${utils.getInput("buildconfig")}-${cacheVersion}`;
    const toolsCachePath = [
        `${toolPath}`
    ]
    core.info(`tries to save ${toolname} to cache with path ${toolPath} with key: ${key}`);
    try {
        return await cache.saveCache(toolsCachePath, key);
    } catch (e) {
        core.info(`tried to save ${toolname} to cache with path ${toolPath} with key: ${key} failed, proberly exists already`);
        return 0;
    }
}
exports.set = set;

async function get(toolname, cacheVersion) {
    const key = `${toolname}-${os.platform()}-${utils.getInput("buildconfig")}-${cacheVersion}`;
    let toolPath = ""
    if (toolname != "libs") {
        const libJson = utils.parseLibsFile(utils.getInput("libjsonpath"));
        toolPath = utils.getLibPath(libJson, toolname);
    } else {
        toolPath = utils.getInput("libpath");
    }
    core.info(`tries to get ${toolname} from cache with path ${toolPath} with key: ${key}`);
    const toolsCachePath = [
        `${toolPath}`
    ]
    if (await cache.restoreCache(toolsCachePath, key) != undefined) {
        return toolPath;
    } else {
        throw new Error(`${toolname} is not cached`)
    }
}
exports.get = get;

