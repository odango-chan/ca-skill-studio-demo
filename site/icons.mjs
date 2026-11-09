// Unified 24px rounded outline icon vocabulary for SKILL Studio.
// Local SVG geometry only: no external fonts/CDNs, SVG innerHTML, or remote assets.
// The same definitions serve DOM-based Explorer and React Flow node cards.
const NS="http://www.w3.org/2000/svg";
const p=d=>["path",{d}];
const line=(x1,y1,x2,y2)=>["line",{x1,y1,x2,y2}];
const circle=(cx,cy,r)=>["circle",{cx,cy,r}];
const rect=(x,y,width,height,rx=0)=>["rect",{x,y,width,height,rx}];
const poly=points=>["polyline",{points}];
const defs={
  workflow:[rect(2.5,3,7,7,2),rect(14.5,14,7,7,2),
    p("M9.5 6.5h4a3 3 0 0 1 3 3V14"),p("M6 10v4a3 3 0 0 0 3 3h5.5")],
  "git-branch":[circle(6,4,2),circle(18,10,2),circle(6,20,2),
    p("M6 6v12"),p("M6 12h8a4 4 0 0 0 4-4")],
  "corner-down-right":[p("M5 4v9a5 5 0 0 0 5 5h9"),poly("14 13 19 18 14 23")],
  "chevron-left":[poly("15 18 9 12 15 6")],
  "chevron-right":[poly("9 18 15 12 9 6")],
  "chevron-down":[poly("6 9 12 15 18 9")],
  "arrow-left":[p("M19 12H5"),poly("12 19 5 12 12 5")],
  "panel-left-close":[rect(3,3,18,18,2),line(9,3,9,21),poly("6.5 10 4.5 12 6.5 14")],
  "panel-left-open":[rect(3,3,18,18,2),line(9,3,9,21),poly("5 10 7 12 5 14")],
  "panel-right-open":[rect(3,3,18,18,2),line(15,3,15,21),poly("18 10 16 12 18 14")],
  "panel-right-close":[rect(3,3,18,18,2),line(15,3,15,21),poly("17 10 19 12 17 14")],
  folder:[p("M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z")],
  "folder-open":[p("M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2H6a3 3 0 0 0-3 2Z"),
    p("M3 20l2.5-7h16L19 20Z")],
  file:[p("M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z"),
    poly("13 3 13 10 20 10")],
  "file-text":[p("M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z"),
    poly("13 3 13 10 20 10"),line(8,14,16,14),line(8,17,15,17)],
  "file-code":[p("M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z"),
    poly("13 3 13 10 20 10"),poly("10 13 8 15 10 17"),poly("14 13 16 15 14 17")],
  "file-json":[p("M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z"),
    poly("13 3 13 10 20 10"),p("M10 13c-2 0-2 1-2 2s0 2 2 2"),
    p("M14 13c2 0 2 1 2 2s0 2-2 2")],
  "file-terminal":[p("M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z"),
    poly("13 3 13 10 20 10"),poly("8 13 11 15 8 17"),line(12.5,17,16,17)],
  "file-check":[p("M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z"),
    poly("13 3 13 10 20 10"),poly("8 16 11 18 17 12")],
  package:[rect(3,7,18,14,2),poly("3 10 12 15 21 10"),line(12,15,12,21),
    poly("3 7 12 3 21 7")],
  "shield-check":[p("M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"),poly("9 12 11 14 15 10")],
  "list-checks":[line(10,6,21,6),line(10,12,21,12),line(10,18,21,18),
    poly("3 6 4.5 7.5 7 4.5"),poly("3 12 4.5 13.5 7 10.5"),
    poly("3 18 4.5 19.5 7 16.5")],
  "undo-2":[p("M9 14 4 9l5-5"),p("M4 9h10a6 6 0 0 1 0 12h-3")],
  "redo-2":[p("m15 14 5-5-5-5"),p("M20 9H10a6 6 0 0 0 0 12h3")],
  download:[p("M12 3v12"),poly("7 10 12 15 17 10"),p("M4 17v3h16v-3")],
  archive:[rect(3,4,18,4,1),p("M5 8v12h14V8"),line(10,12,14,12)],
  "folder-plus":[p("M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"),
    line(12,11,12,17),line(9,14,15,14)],
  "network":[rect(9,2,6,6,1),rect(2,16,6,6,1),rect(16,16,6,6,1),
    p("M12 8v4"),p("M5 16v-4h14v4")],
  "columns-2":[rect(3,4,18,16,2),line(12,4,12,20)],
  "code-2":[poly("8 8 4 12 8 16"),poly("16 8 20 12 16 16"),line(14,5,10,19)],
  "eye":[p("M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"),circle(12,12,2.5)],
  "locate-fixed":[circle(12,12,3),line(12,2,12,6),line(12,18,12,22),
    line(2,12,6,12),line(18,12,22,12)],
  maximize:[poly("8 3 3 3 3 8"),poly("16 3 21 3 21 8"),
    poly("3 16 3 21 8 21"),poly("16 21 21 21 21 16")],
  "fit-width":[rect(6,7,12,10,1.5),
    line(3,4,3,20),line(21,4,21,20),
    poly("9 9 6 12 9 15"),poly("15 9 18 12 15 15")],
  "fit-height":[rect(7,6,10,12,1.5),
    line(4,3,20,3),line(4,21,20,21),
    poly("9 9 12 6 15 9"),poly("9 15 12 18 15 15")],
  "zoom-in":[circle(10.5,10.5,7),line(16,16,21,21),line(7.5,10.5,13.5,10.5),
    line(10.5,7.5,10.5,13.5)],
  "zoom-out":[circle(10.5,10.5,7),line(16,16,21,21),line(7.5,10.5,13.5,10.5)],
  "rotate-ccw":[p("M3 8V3h5"),p("M3 8a9 9 0 1 1 2.6 10.2")],
  search:[circle(10.5,10.5,7),line(16,16,21,21)],
  settings:[circle(12,12,3),p("M10 2h4l.5 2.6 2 1L19 4l3 3-1.6 2.5 1 2L24 12l-2.6.5-1 2L22 17l-3 3-2.5-1.6-2 1L14 22h-4l-.5-2.6-2-1L5 20l-3-3 1.6-2.5-1-2L0 12l2.6-.5 1-2L2 7l3-3 2.5 1.6 2-1Z")],
  "plug-zap":[p("M8 3v4"),p("M16 3v4"),p("M6 7h12v5a6 6 0 0 1-12 0Z"),
    line(12,18,12,22),poly("13 9 10 13 13 13 11 16")],
  "circle-check":[circle(12,12,9),poly("8 12 11 15 16 9")],
  "circle-stop":[circle(12,12,9),rect(9,9,6,6,1)],
  "refresh-cw":[p("M20 7v-4h-4"),p("M4 17v4h4"),
    p("M5 9a8 8 0 0 1 14-2l1 0"),p("M19 15a8 8 0 0 1-14 2l-1 0")],
  flag:[p("M5 3v18"),p("M5 4h14l-3 5 3 5H5")],
  wrench:[p("M14 6a6 6 0 0 0-7 7l-5 5a2 2 0 0 0 3 3l5-5a6 6 0 0 0 8-7l-4 4-3-3 3-4Z")],
  "file-diff":[p("M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z"),
    poly("13 3 13 10 20 10"),line(8,14,16,14),line(12,11,12,17)],
  plus:[line(12,5,12,19),line(5,12,19,12)],
  minus:[line(5,12,19,12)],
  x:[line(18,6,6,18),line(6,6,18,6)],
  menu:[line(4,7,20,7),line(4,12,20,12),line(4,17,20,17)],
  "more-horizontal":[circle(5,12,1),circle(12,12,1),circle(19,12,1)],
  "chevron-up":[poly("6 15 12 9 18 15")],
  "file-plus":[p("M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z"),
    poly("13 3 13 10 20 10"),line(12,13,12,19),line(9,16,15,16)],
  "sliders-horizontal":[line(4,6,20,6),circle(9,6,2),line(4,12,20,12),
    circle(15,12,2),line(4,18,20,18),circle(7,18,2)],
  play:[poly("9 6 19 12 9 18 9 6")],
  check:[poly("5 12 10 17 19 7")]
};
export const ICON_SHAPES=Object.freeze(Object.fromEntries(
  Object.entries(defs).map(([name,shapes])=>[name,Object.freeze(shapes.map(
    ([tag,attrs])=>Object.freeze({tag,attrs:Object.freeze(attrs)})
  ))])
));
export function iconShapes(name){
  if(!Object.hasOwn(ICON_SHAPES,name))throw new Error("Unknown Studio icon: "+name);
  return ICON_SHAPES[name];
}
export function createIcon(document,name,{size=16,className=""}={}){
  const svg=document.createElementNS(NS,"svg");
  for(const [k,v] of Object.entries({
    viewBox:"0 0 24 24",width:size,height:size,
    fill:"none",stroke:"currentColor","stroke-width":1.75,
    "stroke-linecap":"round","stroke-linejoin":"round",
    "aria-hidden":"true",focusable:"false","data-icon":name,
    class:"studio-icon"+(className?" "+className:"")
  }))svg.setAttribute(k,String(v));
  for(const {tag,attrs} of iconShapes(name)){
    const child=document.createElementNS(NS,tag);
    for(const [key,value] of Object.entries(attrs))
      child.setAttribute(key,String(value));
    svg.appendChild(child);
  }
  return svg;
}
export function operatorIcon(operator){
  return ({
    call:"plug-zap",tool:"wrench",verify:"shield-check",
    predicate:"circle-check",terminal:"circle-stop",
    procedure:"workflow",reconcile:"refresh-cw",script:"file-code"
  })[operator]||"workflow";
}
