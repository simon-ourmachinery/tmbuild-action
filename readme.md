**# tmbuild-action**

A GitHub action to build ***\*The Machinery\****'s one click build tool as well as the engine itself. This action will cache all depencies as well as the build tool itself if required. It supports to pack the engine or you plugin at the end.

**## Features**

- Will report errors and warnings via annotations
- Can caches the dependencies and `tmbuild`
- You can build the Engine
- You can build your plugin.
- You can define a repository for the engines dependencies
- You can package the engine/plugin

**## Examples:**

**How to build:**

```yaml

  - name: run tmbuild via action
   uses: ./tmbuild-action
   id: tmbuild
   with:
​    config: Debug

```

*Plugin build*

```yaml
  - name: run tmbuild via action
   uses: ./tmbuild-action
  with:
    binary_repository: https://ourmachinery.com/releases/2021.4/beta-2021.4-linux.zip
    mode: Plugin
    config: Debug
```

**How to package:**

```yaml

  - name: Package Engine with beta-package.json setting
   uses: ./tmbuild-action
   id: tmbuild
   with:
    package: beta-package.json
```

*Plugin build*

```yaml
  - name: run tmbuild via action
   uses: ./tmbuild-action
  with:
    binary_repository: https://ourmachinery.com/releases/2021.4/beta-2021.4-linux.zip
    mode: Plugin
    package: package.json
```

**## Variable overview:**

**### Inputs**

- Build Settings:
 - `mode: [Engine|Plugin] (default: Engine)` 
 - `clang: [true|false] (default: false)` will build on Windows (only) with clang
 - `config: [Debug|Release] (default: Debug)` 
 - `package: [string value of a package.json] (default: not set)` If set with a valid package file the action will package the engine
 - `project: [string value of project name] (default: not set)` If provided `tmbuild` builds only this project.
 - `gendoc: [true|false] (default: false)` will generate documentation after the build and output it in the `./build/doc` folder
 - `gennode: [true|false] (default: false)` will generate node inline files
 - `genhash: [true|false] (default: false)` will generate hashes if any are missing
- Config optional:
 - `libpath: [string path to where the dependencies shall be stored] (default: ./lib)` *should be the same value as the TM_LIB_DIR* if not provided it tries first to use the environment variable `TM_LIB_DIR` and than the default value.
 - `cache: [true|false] (default: true)` enables caching of `tmbuild` and `./libs`
- `path: [working directory] (default: ./)` the root directory of the execution. In `Engine mode` this should be the root of the engine source in `Plugin mode` this should be the root of the plugin source.

*Relevant for mode: Engine*

 - `tmbuild_repository: [string url to repo] (default: tm default repo)` Should be a valid HTTP(S) domain, is used to download the dependencies needed to build `tmbuild` before the engine can be build.

*Relevant for mode: Plugin*

 - `binary_repository: [string url to tm build zip] (default: not set)` Can be used to build against a tm build version. Will download and unzip the engine and uses the build in `tmbuild` version

 

 **## Remarks**

 The action will automatically detect changes in `tmbuild` or in lib dependencies in Engine mode.