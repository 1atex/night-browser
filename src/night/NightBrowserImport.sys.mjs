import {MigrationUtils} from 'moz-src:///browser/components/migration/MigrationUtils.sys.mjs';
import {PrivateBrowsingUtils} from 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs';
import {browserImportSource,importCategories} from 'resource:///modules/night/BrowserImportModel.mjs';
export const NightBrowserImport={
  running:false,
  async importPasswords(window){
    if(PrivateBrowsingUtils.isWindowPrivate(window))throw Error('Импорт доступен в обычном окне.');
    const picker=Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);picker.init(window.browsingContext,'Пароли из CSV или TSV',Ci.nsIFilePicker.modeOpen);picker.appendFilter('CSV','*.csv');picker.appendFilter('TSV','*.tsv');
    if(await new Promise(resolve=>picker.open(resolve))!==Ci.nsIFilePicker.returnOK)return null;
    const {LoginCSVImport}=ChromeUtils.importESModule('resource://gre/modules/LoginCSVImport.sys.mjs');
    const rows=await LoginCSVImport.importFromCSV(picker.file.path);return rows.reduce((result,row)=>{if(String(row.result).startsWith('error'))result.errors++;else if(row.result==='no_change')result.unchanged++;else result.imported++;return result;},{imported:0,unchanged:0,errors:0});
  },
  async inspect(key){
    const source=browserImportSource(key);if(source.mode!=='native')throw Error('Для этого браузера нужен перенос профиля.');
    const migrator=await MigrationUtils.getMigrator(key);if(!migrator||migrator.startupOnlyMigrator)return {source,profiles:[],available:false};
    const profiles=await migrator.getSourceProfiles()??[{id:'',name:'Основной профиль'}],result=[];
    for(const profile of profiles){const types=await migrator.getMigrateData(profile);result.push({id:profile.id,name:profile.name??profile.id,types:importCategories.filter(([name])=>types&MigrationUtils.resourceTypes[name]).map(([name,label])=>({name,label,flag:MigrationUtils.resourceTypes[name]}))});}
    return {source,profiles:result,available:result.length>0};
  },
  async migrate(window,key,profileId,categories,progress=()=>{}){
    if(PrivateBrowsingUtils.isWindowPrivate(window))throw Error('Импорт доступен в обычном окне.');
    if(this.running)throw Error('Другой импорт ещё выполняется.');
    const source=browserImportSource(key);if(source.mode!=='native')throw Error('Неверный способ импорта.');
    const migrator=await MigrationUtils.getMigrator(key);if(!migrator)throw Error('Профиль исходного браузера не найден.');
    if(!await migrator.hasPermissions()&&!await migrator.getPermissions(window))throw Error('Нет разрешения на чтение профиля.');
    const profiles=await migrator.getSourceProfiles()??[{id:'',name:'Основной профиль'}],profile=profiles.find(value=>value.id===profileId);if(!profile)throw Error('Профиль не найден.');
    if(!Array.isArray(categories)||!categories.length||categories.some(name=>!importCategories.some(([allowed])=>allowed===name)))throw Error('Выбери данные для импорта.');
    const available=await migrator.getMigrateData(profile),selected=categories.reduce((bits,name)=>bits|MigrationUtils.resourceTypes[name],0);if((available&selected)!==selected)throw Error('Часть данных сейчас недоступна. Обнови список профилей.');
    this.running=true;const result=[];
    try{await migrator.migrate(selected,null,profile,(type,success,details)=>{const name=importCategories.find(([name])=>MigrationUtils.resourceTypes[name]===Number(type))?.[1]??'Данные';const value={type:Number(type),name,success:!!success,details};result.push(value);progress(value);});return {source:source.name,results:result};}finally{this.running=false;}
  },
};
