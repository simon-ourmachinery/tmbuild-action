const core = require('@actions/core');
const cache = require('@actions/cache');
const os = require('os');
const utils = require('./utils');

function get_key(toolname, cacheVersion) {
    const key = `${toolname}-${os.platform()}-${core.getInput("config")}-${core.getInput("mode")}-${cacheVersion}-suffix-10`;
    return key;
}

exports.get_key = get_key;

async function set(toolPath, toolname, cacheVersion) {
    const key = get_key(toolname, cacheVersion);
    const toolsCachePath = [
        toolPath
    ]
    try {
        utils.info(`tries to save ${toolname} to cache with path ${toolPath} with key: ${key}`);
        return await cache.saveCache(toolsCachePath, key);
    } catch (e) {
        core.debug(e.message);
        utils.info(`tried to save ${toolname} to cache with path ${toolPath} with key: ${key} failed, proberly exists already`);
        return 0;
    }
}
exports.set = set;

async function get(toolPath, toolname, cacheVersion) {
    const key = get_key(toolname, cacheVersion);
    const toolsCachePath = [
        toolPath
    ]
    try {
        utils.info(`tries to get ${toolname} from cache with path ${toolPath} with key: ${key}`);
        let return_key = await cache.restoreCache(toolsCachePath, key);
        if (return_key != undefined) {
            utils.info(`Successfully found. ${return_key}`);
            return toolPath;
        }
    } catch (e) {
        core.info(e.message);
        throw new Error(`${toolname} is not cached`);
    }
}
exports.get = get;

