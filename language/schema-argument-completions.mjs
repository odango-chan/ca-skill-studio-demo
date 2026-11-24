// Source-only LSP CompletionItems for CA-SL arguments from immutable,
// explicitly verified Interface Package input Schema declarations.
// Never infer source expressions, runtime values, or Owner authorization.
const COMPLETION_PROPERTY=10,COMPLETION_ENUM=20;
const SAFE_TOOL=/^[a-z][a-z0-9-]*::[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
function stageContext(source,lineStart){
  let nodes=false,node=null,stage=null,section=null,tool=null,existing=new Set();
  const lines=source.slice(0,lineStart).split(/\r?\n/);
  // A comment cannot establish a stage, Tool identity or declared argument.
  for(const line of lines){
    if(/^nodes:\s*(?:#.*)?$/.test(line)){
      nodes=true;node=null;stage=null;section=null;tool=null;continue;
    }
    if(/^[^\s#]/.test(line)){
      nodes=false;node=null;stage=null;section=null;tool=null;continue;
    }
    if(!nodes)continue;
    if(/^ {2}[A-Za-z][A-Za-z0-9_-]*:\s*(?:#.*)?$/.test(line)){
      node=true;stage=null;section=null;tool=null;continue;
    }
    if(!node)continue;
    const nextStage=/^ {4}(operation|observation|precondition|postcondition):\s*(?:#.*)?$/.exec(line);
    if(nextStage){
      stage=nextStage[1];section=null;tool=null;existing=new Set();continue;
    }
    if(!stage)continue;
    const field=/^ {6}(tool|arguments|routes|script|predicates|retryOf):(?:\s*(.*?))?\s*$/.exec(line);
    if(field){
      if(field[1]==='tool'){
        const value=(field[2]??'').split(/\s+#/)[0].trim();
        tool=SAFE_TOOL.test(value)?value:null;
      }
      section=field[1]==='arguments'?'arguments':null;
      if(section==='arguments')existing=new Set();
      continue;
    }
    if(section==='arguments'){
      const arg=/^ {8}([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/.exec(line);
      if(arg)existing.add(arg[1]);
    }
  }
  return {stage,section,tool,existing};
}
function edit(start,end,lineStart,newText,kind,label,detail,documentation,sortText){
  return {
    label,kind,detail,documentation,
    ...(sortText?{sortText}:{}),
    textEdit:{range:{
      start:{line:0,character:start-lineStart},
      end:{line:0,character:end-lineStart}
    },newText}
  };
}
export function schemaArgumentCompletions(snapshot,document,prefix,offset,lineStart,lineNumber){
  if(document?.relativePath!=='assurance/procedure.yaml'||
     snapshot?.completeness!=='complete'||
     !Array.isArray(snapshot.schemaCompletionHints)||
     typeof prefix!=='string'||!Number.isSafeInteger(offset)||
     !Number.isSafeInteger(lineStart)||!Number.isSafeInteger(lineNumber))
    return null;
  const context=stageContext(document.text,lineStart);
  if(!['operation','observation'].includes(context.stage)||
     context.section!=='arguments'||!context.tool)return null;
  const matches=snapshot.schemaCompletionHints.filter(item=>
    item.id===context.tool&&item.kind===context.stage&&
    item.trust==='DECLARATION_ONLY'&&Array.isArray(item.argumentProperties));
  // Never select one arbitrarily from duplicate or stale declarations.
  if(matches.length!==1)return [];
  const hint=matches[0];
  const properties=hint.argumentProperties.filter(p=>
    p&&typeof p.name==='string'&&/^[A-Za-z_][A-Za-z0-9_-]*$/.test(p.name));
  if(properties.length!==hint.argumentProperties.length||properties.length>256)return [];
  const key=/^ {8}([A-Za-z_][A-Za-z0-9_-]*)?$/.exec(prefix);
  if(key){
    const typed=key[1]??'';
    const start=offset-typed.length;
    return properties.filter(p=>p.name.startsWith(typed)&&
      !context.existing.has(p.name)).sort((a,b)=>
      Number(Boolean(b.required))-Number(Boolean(a.required))||
      a.name.localeCompare(b.name)).map(p=>{
      const detail=(p.required?'required · ':'optional · ')+p.type+
        ' · published Schema '+hint.inputSchemaId+' · NOT_AUTHORIZED';
      const item=edit(start,offset,lineStart,p.name+': ',COMPLETION_PROPERTY,
        p.name,detail,p.description||p.title||'',p.required?'0'+p.name:'1'+p.name);
      item.textEdit.range.start.line=lineNumber;
      item.textEdit.range.end.line=lineNumber;
      return item;
    });
  }
  const value=/^ {8}([A-Za-z_][A-Za-z0-9_-]*):[ \t]*([A-Za-z0-9_.-]*)$/.exec(prefix);
  if(value){
    const property=properties.find(p=>p.name===value[1]);
    if(!property||!Array.isArray(property.choices)||!property.choices.length)return null;
    const typed=value[2],start=offset-typed.length;
    return property.choices.filter(choice=>
      ['string','boolean','number'].includes(typeof choice)&&
      String(choice).startsWith(typed)).map(choice=>{
      const yaml=typeof choice==='string'?JSON.stringify(choice):String(choice);
      const item=edit(start,offset,lineStart,yaml,COMPLETION_ENUM,String(choice),
        'enum · '+hint.inputSchemaId+' · NOT_AUTHORIZED',
        property.description||'',null);
      item.textEdit.range.start.line=lineNumber;
      item.textEdit.range.end.line=lineNumber;
      return item;
    });
  }
  return null;
}
