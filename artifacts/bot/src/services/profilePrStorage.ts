import {createHash} from "node:crypto";
import {mkdir,open,readFile} from "node:fs/promises";
import {join,resolve} from "node:path";

/** Immutable PR text objects outside PostgreSQL. A durable, backed-up mounted
 * volume must be supplied before enabling this feature in a runtime. */
const storageRoot=()=> {
 const root=process.env.PROFILE_PR_STORAGE_DIR;
 if(!root||!root.startsWith("/"))throw Error("PROFILE_PR_DURABLE_STORAGE_NOT_CONFIGURED");
 return resolve(root);
};
const owner=(id:number)=>{
 if(!Number.isSafeInteger(id)||id<1)throw Error("PROFILE_PR_OWNER_INVALID");
 return String(id);
};
const identifier=(ref:string)=>{
 if(!/^[a-f0-9]{64}$/.test(ref))throw Error("PROFILE_PR_REFERENCE_INVALID");
 return ref;
};
const pathFor=(id:number,ref:string)=>join(storageRoot(),owner(id),identifier(ref)+".txt");
export async function storeProfilePr(id:number,body:string):Promise<string>{
 if(!body||body.length>10000)throw Error("PROFILE_PR_LENGTH_INVALID");
 const digest=createHash("sha256").update(owner(id)+"\0"+body).digest("hex");
 const dir=join(storageRoot(),owner(id));
 await mkdir(dir,{recursive:true,mode:0o700});
 const filename=pathFor(id,digest);
 try{
  const file=await open(filename,"wx",0o600);
  try{await file.writeFile(body,"utf8");await file.sync();}finally{await file.close();}
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
 }
 const actual=await readProfilePr(id,digest);
 if(actual!==body)throw Error("PROFILE_PR_STORAGE_MISMATCH");
 return digest;
}
export async function readProfilePr(id:number,ref:string):Promise<string>{
 const body=await readFile(pathFor(id,ref),"utf8");
 if(createHash("sha256").update(owner(id)+"\0"+body).digest("hex")!==ref)
  throw Error("PROFILE_PR_STORAGE_CORRUPT");
 return body;
}
