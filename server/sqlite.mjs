import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
export function openDatabase(path=':memory:',migrationDir=resolve('drizzle')){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
  const sqlite=new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS bridge_migrations(name TEXT PRIMARY KEY)');
  for(const name of readdirSync(migrationDir).filter(n=>n.endsWith('.sql')).sort()){
    if(sqlite.prepare('SELECT name FROM bridge_migrations WHERE name=?').get(name))continue;
    sqlite.exec('BEGIN');
    try{sqlite.exec(readFileSync(resolve(migrationDir,name),'utf8'));sqlite.prepare('INSERT INTO bridge_migrations(name) VALUES(?)').run(name);sqlite.exec('COMMIT');}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
  const prepare=(sql)=>{
    let values=[];
    const query={bind(...args){values=args;return query;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const result=sqlite.prepare(sql).run(...values);return {meta:{changes:result.changes}};}};
    return query;
  };
  return {prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},close(){sqlite.close();}};
}
