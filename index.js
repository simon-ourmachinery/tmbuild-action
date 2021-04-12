// GitHub dependencies:
const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');



// internal dependencies
const utils = require("./internal/utils");
const tools = require("./internal/tools");
const build = require("./internal/build");
const cache = require("./internal/cache");
const os = require("os");
const fs = require('fs');

global.log_out_content = "";

global.log_out_content = "";

async function build_tmbuild(buildconfig, ending) {
    await build.make();
    await build.build_tmbuild();
    await utils.cp(`./bin/${buildconfig}/tmbuild${ending}`, `./bin/tmbuild/${buildconfig}`);
}

(async () => {
    let caches = [];
    let new_caches = [];
    try {
        const usePackEngine = utils.getInput("usePackEngine") === 'true';
        const canBuild = utils.getInput("build") === 'true';
        let buildtmbuild = utils.getInput("buildtmbuild") === 'true';
        const libpath = utils.getInput("libpath");
        const buildconfig = utils.getInput("buildconfig");
        const libjson = utils.parseLibsFile(utils.getInput("libjsonpath"));
        // cache settings:
        const cacheLibs = utils.getInput("cacheLibs") === 'true';
        const useCache = utils.getInput("useCache") === 'true';
        const cacheVersion = await tools.hash("./utils/tmbuild/tmbuild.c");
        const libcacheVersion = await tools.hash(`${utils.getInput("libjsonpath")}/libs.json`);
        const unittestcacheVersion = await tools.hash(`./unit_test/unit_test.c`) + "_" + await tools.hash(`./unit_test/unit_test_renderer.c`);
        const ending = (os.platform() == "win32") ? ".exe" : "";
        // if true package and cache at the end libs and tmbuild      
        let libCacheIsDirty = false;
        let tmbuildCacheIsDirty = false;
        let unittestCacheIsDirty = true;
        // artifact
        const packageArtifact = utils.getInput("packageArtifact") === 'true';
        if (!usePackEngine) {
            // downloads the cache and if cache does not exist it will install it:
            if (useCache) {
                // download cached libs (dependencies)
                if (cacheLibs) {
                    try {
                        core.startGroup("[tmbuild-action] get cached dependencies");
                        await cache.get("libs", libcacheVersion);
                        caches.push({ name: "libs", version: libcacheVersion });
                        core.endGroup();
                    } catch (e) {
                        utils.info(e.message);
                        await tools.install("bearssl");
                        await tools.install("premake5");
                        if (os.platform() != "win32") {
                            const toolObject = utils.getLib(libjson, "premake5");
                            const toolname = toolObject.lib;
                            await tools.chmod(`${libpath}/${toolname}/premake5`);
                        }
                        libCacheIsDirty = true;
                    }
                }
                // downloads cached tmbuild version
                if (!buildtmbuild) {
                    core.startGroup(`[tmbuild-action] get cached tmbuild-${buildconfig}`);
                    try {
                        await cache.get(`tmbuild`, cacheVersion);
                        caches.push({ name: "tmbuild", version: cacheVersion });
                    } catch (e) {
                        utils.info(e.message);
                        await build_tmbuild(buildconfig, ending);
                        tmbuildCacheIsDirty = true;
                    }
                    core.endGroup();
                }

                core.startGroup(`[tmbuild-action] get cached unit-test-${buildconfig}`);
                try {
                    await cache.get(`unit-test`, unittestcacheVersion);
                    caches.push({ name: "unit-test", version: unittestcacheVersion });
                    await utils.cp(`./bin/unit_test/${buildconfig}/unit-test${ending}`, `./bin`);
                    unittestCacheIsDirty = false;
                } catch (e) {
                    utils.info("Cannot get unit test from cache");
                }
                core.endGroup();

            } else {
                await tools.install("bearssl");
                await tools.install("premake5");
                if (os.platform() != "win32") {
                    const toolObject = utils.getLib(libjson, "premake5");
                    const toolname = toolObject.lib;
                    await tools.chmod(`${libpath}/${toolname}/premake5`);
                }
            }

            // cache tmbuild if needed
            if (useCache && tmbuildCacheIsDirty) {
                try {
                    await cache.set(`./bin/tmbuild/${buildconfig}`, `tmbuild`, cacheVersion);
                    new_caches.push({ name: "tmbuild", version: cacheVersion });
                } catch (e) {
                    utils.warning(`There was an error with setting the cache for tmbuild ${e.message}`);
                    // make sure we recover from error and build tmbuild again....
                    buildtmbuild = true;
                    tmbuildCacheIsDirty = false;
                }
            }

            // build tmuild if needed
            if (buildtmbuild && !tmbuildCacheIsDirty) {
                await build_tmbuild(buildconfig, ending);
            }
        }

        // build engine or project
        if (canBuild) {
            await build.tmbuild(utils.getInput("package"));
            if (useCache && unittestCacheIsDirty) {
                try {
                    await utils.cp(`./bin/${buildconfig}/unit-test${ending}`, `./bin/unit_test/${buildconfig}`);
                    try {
                        const toolPath = utils.getLibPath(libjson, "unit-test");
                        if (fs.existsSync(toolPath)) {
                            await cache.set(toolPath, `unit-test`, unittestcacheVersion);
                            new_caches.push({ name: "unit-test", version: unittestcacheVersion });
                        } else {
                            utils.info(`There was an error with setting the cache for unit-test, ${toolPath} could not be found`);
                        }
                    } catch (e) {
                        utils.info(`There was an error with setting the cache for unit-test: ${e.message}`);
                    }
                } catch (e) {
                    utils.info(`There was an error with setting the cache for unit-test, ./bin/${buildconfig}/uint-test${ending} could not be found.\nPossible reason the build failed.`);
                }
            }
        }

        if (useCache && libCacheIsDirty && !usePackEngine) {
            try {
                await cache.set(libpath, `libs`, libcacheVersion);
                new_caches.push({ name: "libs", version: libcacheVersion });
            } catch (e) {
                utils.warning(`There was an error with setting the cache for libs ${e.message}`);
            }
        }

        const currentDate = new Date();
        const date = currentDate.getDate();
        const month = currentDate.getMonth();
        const year = currentDate.getFullYear();
        const now = `${date}-${month}-${year}`;

        if (utils.getInput("artifact") === 'true') {
            core.startGroup(`[tmbuild-action] store artifacts`);
            await tools.storeFolder(`bin-${buildconfig}-${now}`, `./bin/${buildconfig}`);
            await tools.storeFolder(`build-${buildconfig}-${now}`, `./build`);
            core.endGroup();
        }

        if (utils.getInput("package").length != 0 && packageArtifact) {
            core.startGroup(`[tmbuild-action] store package artifacts`);
            await tools.storeFile(`package-${buildconfig}-${now}`, `./build/*.zip`);
            core.endGroup()
        } else {
            utils.info("info: packaged project but did not store the artifacts because `packageArtifact` is false");
        }
        const regex = /(^")|("$)/gm;
        const subst = ``;
        const result = JSON.stringify(global.log_out_content).replace(regex, subst).replace(/\\n/g, "\\n");
        core.setOutput('result', result);

    } catch (e) {
        core.setFailed(e.message);
        const regex = /(^")|("$)/gm;
        const subst = ``;
        const result = JSON.stringify(global.log_out_content).replace(regex, subst).replace(/\\n/g, "\\n");
        core.setOutput(`result`, result);

        const currentDate = new Date();
        const date = currentDate.getDate();
        const month = currentDate.getMonth();
        const year = currentDate.getFullYear();
        const now = `${date}-${month}-${year}`;

        if (utils.getInput("artifact") === 'true') {
            core.startGroup(`[tmbuild-action] store artifacts`);
            await tools.storeFolder(`bin-${now}`, `./bin`);
            await tools.storeFolder(`build-${now}`, `./build`);
            core.endGroup();
        }
    }

    core.startGroup(`[tmbuild-action] caches`);
    core.info("Caches:");
    caches.forEach(element => core.info(`name: ${element.name}  version: ${element.version}`));
    core.info("New Caches:");
    new_caches.forEach(element => core.info(`name: ${element.name}  version: ${element.version}`));
    core.endGroup();
})();
