// 이계민원청 독립 실행용 초경량 런타임.
// 기존 x-dc 템플릿의 sc-if/sc-for/이벤트 바인딩과 React 형태의 화면 조각을 처리한다.
(function(){
  const unitless = new Set(['flex','flexGrow','flexShrink','fontWeight','lineHeight','opacity','order','zIndex']);
  let mounted = null;
  let renderQueued = false;

  class DCLogic {
    constructor(props){ this.props = props || {}; this.state = {}; }
    setState(patch){
      const next = typeof patch === 'function' ? patch(this.state) : patch;
      if(next) this.state = Object.assign({}, this.state, next);
      queueRender();
    }
  }

  const React = {
    createElement(type, props, ...children){
      return {__vnode:true, type, props:props || {}, children};
    }
  };

  function queueRender(){
    if(renderQueued) return;
    renderQueued = true;
    queueMicrotask(()=>{ renderQueued=false; renderApp(); });
  }

  function fitViewport(){
    const shell=document.getElementById('game-shell');
    if(!shell) return;
    const scale=Math.max(0.1,Math.min(window.innerWidth/1440,window.innerHeight/900));
    shell.style.transform='translateX(-50%) scale('+scale+')';
  }

  function pathValue(path, ctx, vals){
    const parts = String(path||'').trim().split('.');
    let cur = Object.prototype.hasOwnProperty.call(ctx,parts[0]) ? ctx : vals;
    for(const part of parts){
      if(cur == null) return undefined;
      cur = cur[part];
    }
    return cur;
  }

  function expression(raw, ctx, vals){
    const match = /^\s*\{\{\s*([\w$.-]+)\s*\}\}\s*$/.exec(raw || '');
    return match ? {exact:true,value:pathValue(match[1],ctx,vals)} : {exact:false,value:String(raw||'').replace(/\{\{\s*([\w$.-]+)\s*\}\}/g,(_,p)=>{
      const value=pathValue(p,ctx,vals); return value==null?'':String(value);
    })};
  }

  function append(parent, child){
    if(child == null || child === false) return;
    if(Array.isArray(child)){ child.forEach(c=>append(parent,c)); return; }
    parent.appendChild(child);
  }

  function styleValue(element, styles){
    if(!styles) return;
    for(const [key,value] of Object.entries(styles)){
      if(value == null) continue;
      try { element.style[key] = typeof value === 'number' && !unitless.has(key) ? value+'px' : String(value); } catch(e) {}
    }
  }

  function vnodeNode(vnode){
    if(vnode == null || vnode === false) return document.createDocumentFragment();
    if(typeof vnode === 'string' || typeof vnode === 'number') return document.createTextNode(String(vnode));
    if(Array.isArray(vnode)){
      const frag=document.createDocumentFragment(); vnode.forEach(v=>append(frag,vnodeNode(v))); return frag;
    }
    if(!vnode.__vnode) return document.createTextNode(String(vnode));
    const el=document.createElement(vnode.type);
    for(const [key,value] of Object.entries(vnode.props||{})){
      if(key==='key' || value==null || value===false) continue;
      if(key==='className'){ el.className=value; continue; }
      if(key==='style'){ styleValue(el,value); continue; }
      if(key==='onClick' || key==='onChange'){
        const eventName=key==='onClick'?'click':'change';
        el.addEventListener(eventName,event=>{ if(el.tagName==='BUTTON') event.stopPropagation(); value(event); });
        continue;
      }
      if(key==='disabled'){ el.disabled=!!value; continue; }
      if(key==='value'){ el.value=value; continue; }
      try { el.setAttribute(key,value===true?'':String(value)); } catch(e) {}
    }
    (vnode.children||[]).forEach(child=>append(el,vnodeNode(child)));
    return el;
  }

  const rawTags={
    'SC-RAW-TABLE':'table','SC-RAW-TBODY':'tbody','SC-RAW-TR':'tr','SC-RAW-TD':'td'
  };

  function templateNode(node, ctx, vals){
    if(node.nodeType===Node.TEXT_NODE){
      const out=expression(node.nodeValue,ctx,vals);
      if(out.exact && out.value && out.value.__vnode) return vnodeNode(out.value);
      if(out.exact && Array.isArray(out.value) && out.value.some(v=>v&&v.__vnode)) return vnodeNode(out.value);
      return document.createTextNode(out.exact ? (out.value==null?'':String(out.value)) : out.value);
    }
    if(node.nodeType!==Node.ELEMENT_NODE) return document.createDocumentFragment();
    const tag=node.tagName;
    if(tag==='SC-IF'){
      const value=expression(node.getAttribute('value')||'',ctx,vals).value;
      const frag=document.createDocumentFragment();
      if(value) Array.from(node.childNodes).forEach(child=>append(frag,templateNode(child,ctx,vals)));
      return frag;
    }
    if(tag==='SC-FOR'){
      const list=expression(node.getAttribute('list')||'',ctx,vals).value || [];
      const alias=node.getAttribute('as') || 'item';
      const frag=document.createDocumentFragment();
      Array.from(list).forEach((item,index)=>{
        const childCtx=Object.assign({},ctx,{[alias]:item,$index:index});
        Array.from(node.childNodes).forEach(child=>append(frag,templateNode(child,childCtx,vals)));
      });
      return frag;
    }

    const el=document.createElement(rawTags[tag] || tag.toLowerCase());
    for(const attr of Array.from(node.attributes)){
      const name=attr.name;
      if(name.startsWith('hint-')) continue;
      if(name==='sc-camel-on-click' || name==='sc-camel-on-change'){
        const fn=expression(attr.value,ctx,vals).value;
        const eventName=name.endsWith('click')?'click':'change';
        if(typeof fn==='function') el.addEventListener(eventName,event=>{
          if(el.tagName==='BUTTON') event.stopPropagation();
          fn(event);
        });
        continue;
      }
      const out=expression(attr.value,ctx,vals);
      if(name==='disabled'){
        if(out.value===true || out.value==='true' || (!out.exact && attr.value==='')) el.disabled=true;
        continue;
      }
      if(name==='value' && out.exact){ el.value=out.value==null?'':out.value; continue; }
      try { el.setAttribute(name,out.exact?(out.value==null?'':String(out.value)):out.value); } catch(e) {}
    }
    Array.from(node.childNodes).forEach(child=>append(el,templateNode(child,ctx,vals)));
    return el;
  }

  function renderApp(){
    if(!mounted) return;
    try {
      const vals=mounted.component.renderVals();
      const frag=document.createDocumentFragment();
      Array.from(mounted.template.content.childNodes).forEach(node=>append(frag,templateNode(node,{},vals)));
      mounted.root.replaceChildren(frag);
      document.getElementById('boot-error').hidden=true;
    } catch(error){
      const box=document.getElementById('boot-error');
      box.hidden=false;
      box.textContent='게임을 시작하지 못했습니다.\n'+(error&&error.stack?error.stack:error);
      console.error(error);
    }
  }

  function mountGame(ComponentClass){
    const root=document.getElementById('app');
    const template=document.getElementById('game-template');
    const component=new ComponentClass({deptName:'제7이계민원청',showAuditLog:true});
    mounted={root,template,component};
    fitViewport();
    renderApp();
    if(typeof component.componentDidMount==='function') component.componentDidMount();
    window.addEventListener('resize',fitViewport);
    window.addEventListener('beforeunload',()=>{
      window.removeEventListener('resize',fitViewport);
      if(typeof component.componentWillUnmount==='function') component.componentWillUnmount();
    });
  }

  window.DCLogic=DCLogic;
  window.React=React;
  window.__mountIgyeGame=mountGame;
})();
