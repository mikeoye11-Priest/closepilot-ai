import { parse } from "csv-parse/sync";
export function parseDelimitedRecords(text:string,delimiter?:string):string[][]{
 return parse(text,{bom:true,delimiter:delimiter??detectDelimiter(text),skip_empty_lines:true,relax_column_count:true,relax_quotes:false,record_delimiter:["\r\n","\n","\r"]}) as string[][];
}
export function detectDelimiter(text:string){const line=text.split(/\r?\n/,1)[0]??"";return [",","\t",";"].map(value=>({value,count:count(line,value)})).sort((a,b)=>b.count-a.count)[0]?.value??","}
function count(value:string,delimiter:string){let quoted=false,total=0;for(let i=0;i<value.length;i+=1){if(value[i]==='"'){if(quoted&&value[i+1]==='"'){i+=1;continue}quoted=!quoted}else if(!quoted&&value[i]===delimiter)total+=1}return total}
