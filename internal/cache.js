const core = require('@actions/core');
const cache = require('@actions/cache');
const os = require('os');

async function set(toolPath, toolname, cacheVersion) {
    const key = `${toolname}-${os.platform()}-${core.getInput("config")}-${core.getInput("mode")}-${cacheVersion}`;
    const toolsCachePath = [
        `${toolPath}`
    ]
    utils.info(`tries to save ${toolname} to cache with path ${toolPath} with key: ${key}`);
    try {
        return await cache.saveCache(toolsCachePath, key);
    } catch (e) {
        utils.info(`tried to save ${toolname} to cache with path ${toolPath} with key: ${key} failed, proberly exists already`);
        return 0;
    }
}
exports.set = set;

async function get(toolPath, toolname, cacheVersion) {
    const key = `${toolname}-${os.platform()}-${core.getInput("config")}-${core.getInput("mode")}-${cacheVersion}`;
    utils.info(`tries to get ${toolname} from cache with path ${toolPath} with key: ${key}`);
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

