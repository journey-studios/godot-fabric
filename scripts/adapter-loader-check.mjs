// Execute loader rejection/activation against the exported shared host, without a VM/Godot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateCodegen, verifyCodegen} from './codegen.mjs';
import {verifyNativeSdk} from './native-sdk.mjs';
const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const write = (file,value) => fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
function quoted(file) {if(/[";$\r\n]/.test(file)) throw new Error('Unsupported CMake path');return '"'+file.replaceAll('\\','/')+'"';}
function check({sdk,out,cmake}) {
  if(process.platform!=='darwin'||process.arch!=='arm64') throw new Error('Requires macOS arm64 Release');
  sdk=fs.realpathSync(sdk);verifyNativeSdk(sdk);out=path.resolve(out);
  const rel=path.relative(path.join(root,'build'),out);
  if(!rel||path.isAbsolute(rel)||rel==='..'||rel.startsWith('../')||fs.realpathSync(path.dirname(out))!==path.dirname(out)) throw new Error('Use a canonical fresh build child');
  if(fs.existsSync(out)) throw new Error('Preserve existing witness output');
  fs.mkdirSync(out);fs.mkdirSync(path.join(out,'logs'));
  const sources=['scripts/adapter-loader-check.mjs','tests/adapters/loader_test.cpp','tests/codegen/BadgeNativeComponent.ts','tests/codegen/NativeCodegenProbe.ts'];
  const report={format:'godot-fabric.experimental-adapter-loader-witness/v1',checkedAt:new Date().toISOString(),
    sourceSha256:Object.fromEntries(sources.map(file=>[file,hash(path.join(root,file))])),sdkManifestSha256:hash(path.join(sdk,'manifest.json')),
    stages:[],passed:false,vmCreated:false,godotEngineStarted:false,componentMounted:false,abiCertified:false};
  const save=()=>write(path.join(out,'report.json'),report);
  function run(label,command,args) {
    const result=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
    const log=path.join(out,'logs',label+'.log');fs.writeFileSync(log,JSON.stringify([command,...args])+'\n\n'+(result.stdout??'')+(result.stderr??''));
    report.stages.push({label,exitCode:result.status,log:path.relative(out,log),sha256:hash(log)});save();
    if(result.error||result.status!==0) throw new Error(label+' failed: '+log);return result.stdout;
  }
  try {
    fs.cpSync(path.join(sdk,'lib'),path.join(out,'runtime'),{recursive:true,verbatimSymlinks:true});
    const pkg=path.join(out,'project/packages/fixture');fs.mkdirSync(pkg,{recursive:true});
    for(const name of ['BadgeNativeComponent.ts','NativeCodegenProbe.ts']) fs.copyFileSync(path.join(root,'tests/codegen',name),path.join(pkg,name));
    const generated=path.join(pkg,'generated');
    const combination=read(path.join(sdk,'native-combination.json'));
    const generation={root:pkg,specs:['BadgeNativeComponent.ts','NativeCodegenProbe.ts'],libraryName:'CodegenFixture',out:generated,nativeCombination:combination};
    generateCodegen(generation);verifyCodegen(generation);
    const harness=path.join(out,'harness');fs.mkdirSync(harness);
    const cppdir=path.join(generated,'cpp/react/renderer/components/CodegenFixture');
    const cpp=['ComponentDescriptors','EventEmitters','Props','ShadowNodes','States'].map(name=>quoted(path.join(cppdir,name+'.cpp'))).join('\n');
    const source=quoted(path.join(root,'tests/adapters/loader_test.cpp'));
    const lines=['cmake_minimum_required(VERSION 3.31)','project(adapter_loader_witness LANGUAGES CXX)',
      'find_package(GodotFabricNativeSDK CONFIG REQUIRED PATHS '+quoted(path.join(sdk,'cmake'))+' NO_DEFAULT_PATH)'];
    for(let kind=1;kind<=5;kind++) lines.push('add_library(loader_fixture_'+kind+' SHARED '+source+'\n'+cpp+')',
      'target_compile_definitions(loader_fixture_'+kind+' PRIVATE FABRIC_LOADER_FIXTURE='+kind+')',
      'target_include_directories(loader_fixture_'+kind+' PRIVATE '+quoted(path.join(generated,'cpp'))+')',
      'set_target_properties(loader_fixture_'+kind+' PROPERTIES LIBRARY_OUTPUT_DIRECTORY '+quoted(path.join(out,'fixtures'))+')',
      'godot_fabric_configure_adapter(loader_fixture_'+kind+' HOST_RUNTIME_DIR "../runtime")');
    lines.push('add_executable(adapter_loader_check '+source+')',
      'target_include_directories(adapter_loader_check PRIVATE '+quoted(path.join(generated,'cpp'))+')',
      'godot_fabric_configure_adapter(adapter_loader_check HOST_RUNTIME_DIR "../runtime")','');
    fs.writeFileSync(path.join(harness,'CMakeLists.txt'),lines.join('\n'));
    const client=path.join(out,'client');
    run('configure',cmake,['-S',harness,'-B',client,'-G','Unix Makefiles','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_OSX_ARCHITECTURES=arm64','-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0']);
    run('compile-link',cmake,['--build',client,'--parallel','4']);
    const lib=path.join(pkg,'fixture.dylib');fs.copyFileSync(path.join(out,'fixtures/libloader_fixture_1.dylib'),lib);
    const manifest={format:'godot-fabric.experimental-adapter/v1',id:'LoaderFixture',entryPoint:'godot_fabric_adapter_init_v1',
      library:{path:'fixture.dylib',sha256:hash(lib)},nativeCombination:combination,
      codegenManifest:{path:'generated/manifest.json',sha256:hash(path.join(generated,'manifest.json'))},
      components:['CodegenBadge'],modules:['CodegenProbe'],dependsOn:[]};
    write(path.join(pkg,'adapter.json'),manifest);
    const project=path.join(out,'project');fs.writeFileSync(path.join(project,'bundle.js'),'// Loader fixture has no JavaScript runtime\n');
    const packet={format:'godot-fabric.experimental-adapter-selection/v1',bundle:{path:'bundle.js',sha256:hash(path.join(project,'bundle.js'))},
      nativeCombination:combination,adapters:[{packageRoot:'packages/fixture',manifest:{path:'adapter.json',sha256:hash(path.join(pkg,'adapter.json'))}}]};
    write(path.join(project,'selection.json'),packet);
    const binary=path.join(client,'adapter_loader_check');report.binarySha256=hash(binary);
    const stdout=run('loader',binary,[project,path.join(project,'selection.json'),path.join(sdk,'native-combination.json'),path.join(project,'cases'),
      ...[2,3,4,5].map(kind=>path.join(out,'fixtures','libloader_fixture_'+kind+'.dylib'))]);
    const actual=JSON.parse(stdout.trim());
    if(actual.marker!=='ADAPTER_LOADER_OK'||actual.cases!==21||actual.checks<80||actual.vmCreated||actual.godotEngineStarted||actual.viewFactoryCalls||actual.moduleFactoryCalls||actual.abiCertified)
      throw new Error('Incomplete loader acceptance: '+stdout);
    report.loader=actual;
    verifyNativeSdk(sdk);verifyCodegen(generation);
    if(hash(binary)!==report.binarySha256||hash(path.join(sdk,'manifest.json'))!==report.sdkManifestSha256) throw new Error('Witness artifacts changed');
    for(const [file,digest] of Object.entries(report.sourceSha256)) if(hash(path.join(root,file))!==digest) throw new Error('Source changed: '+file);
    report.passed=true;console.log(JSON.stringify({passed:true,...actual}));
  } catch(error) {report.error=error.message;throw error;} finally {save();}
}
try {
  const values={};const args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2) {if(!['--sdk','--out','--cmake'].includes(args[i])||!args[i+1]||values[args[i]]) throw new Error('Use --sdk, --out and optional --cmake');values[args[i]]=args[i+1];}
  if(!values['--sdk']||!values['--out']) throw new Error('Use --sdk and --out');
  check({sdk:values['--sdk'],out:values['--out'],cmake:fs.realpathSync(values['--cmake']??path.join(root,'.deps/python/bin/cmake'))});
} catch(error) {console.error(error.message);process.exitCode=1;}
