/**
 * Resolve a Problem against the actual native TextDocument, not the active
 * Procedure editor. SourceOffsetRange is UTF-16, exactly as positionAt expects.
 * Package-level and stale/unbounded locations must never invent a token span.
 */
export function diagnosticSourcePosition(document,item){
  if(!document||!item)return null;
  const span=item.range;
  if(span!==undefined&&span!==null){
    if(typeof document.getText!=="function"||
       typeof document.positionAt!=="function")return null;
    const length=document.getText().length;
    if(!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||
       span.start<0||span.end<span.start||span.end>length)return null;
    const position=document.positionAt(span.start);
    return {line:position.line,character:position.character,exact:true};
  }
  if(!Number.isSafeInteger(document.lineCount)||document.lineCount<1||
     !Number.isSafeInteger(item.line)||item.line<1)return null;
  const line=Math.min(item.line-1,document.lineCount-1);
  const column=Number.isSafeInteger(item.column)&&item.column>0
    ?item.column-1:0;
  const maxColumn=typeof document.lineAt==="function"
    ?document.lineAt(line).text.length:column;
  return {line,character:Math.min(column,maxColumn),exact:false};
}
