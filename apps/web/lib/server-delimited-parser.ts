import { parse } from "csv-parse";
import { detectDelimiter } from "./delimited-parser";

export async function parseDelimitedFile(file:Blob,delimiter?:string):Promise<string[][]>{
 const reader=file.stream().getReader(),first=await reader.read();
 if(first.done)return[];
 const selected=delimiter??detectDelimiter(new TextDecoder().decode(first.value,{stream:true}));
 const parser=parse({bom:true,delimiter:selected,skip_empty_lines:true,relax_column_count:true,relax_quotes:false,record_delimiter:["\r\n","\n","\r"]});
 const records:string[][]=[];
 const complete=new Promise<void>((resolve,reject)=>{
  parser.on("readable",()=>{let record;while((record=parser.read())!==null)records.push(record as string[])});
  parser.on("error",reject);parser.on("end",resolve);
 });
 parser.write(first.value);
 while(true){const chunk=await reader.read();if(chunk.done)break;parser.write(chunk.value)}
 parser.end();await complete;return records;
}
