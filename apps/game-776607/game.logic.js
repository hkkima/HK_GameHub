//@@DOCS@@

class Component extends DCLogic {
  constructor(p){
    super(p);
    this.saveKey = 'igye_save_v1';
    this.saveVersion = 1;
    this.saveReady = false;
    this.saveTimer = null;

    // 스테이지는 시간 대신 처리량과 정확도 목표로 클리어한다.

    // 7급부터는 기재사항 대조 대신, 9~8급과 같은 계획 항목 판독을 한 단계 더 확장한다.
    // 원본의 기재 흠결 문서는 '첨부 계획 불일치' 단서가 있는 계획형 문서로 정규화한다.
    this.docs = DOCS.map(doc=>{
      if(doc.type !== 'forgery') return doc;
      const badField = doc.fields.find(f=>f.bad);
      const clueIndex = doc.no.split('').reduce((n,ch)=>n+(parseInt(ch,10)||0),0) % 3;
      const clue = badField
        ? '첨부 계획서의 「'+badField.k+'」 표기가 신청서 내용과 일치하지 않음'
        : '첨부 계획이 신청 목적 및 앞선 계획과 일치하지 않음';
      return Object.assign({}, doc, {
        plans: doc.plans.map((p,i)=> i===clueIndex
          ? {t:clue, bad:true}
          : Object.assign({}, p)),
        fields: doc.fields.map(f=>Object.assign({}, f, {bad:false}))
      });
    });

    // 유형 표시. proc(절차 구분)만 서류 카드에 노출한다 — label 을 카드에 띄우면
    // 배지만 읽고 정답을 맞힐 수 있게 되므로 정산 보고서와 인사 화면에서만 쓴다.
    this.typeInfo = {
      standard:  {label:'일반 심사',      proc:'일반'},
      clean:     {label:'적격 심사',      proc:'일반'},
      multi:     {label:'복수 위반',      proc:'일반'},
      forgery:   {label:'첨부 계획 불일치', proc:'일반'},
      pressure:  {label:'의도 위법',      proc:'일반'},
      expedite:  {label:'급행 처리',      proc:'급행'},
      directive: {label:'지시 첨부',      proc:'지시'}
    };

    // 계급. unlock 이 서류 유형 해금을 담당하므로 초반에 7종이 한꺼번에 나오지 않는다.
    this.ranks = [
      {name:'9급 서기보',   short:'9급', need:0,    unlock:['standard','clean'],
       perk:'표준 심사·적격 서류 배정', note:'책상과 도장을 지급받았습니다.'},
      {name:'8급 서기',     short:'8급', need:300,  unlock:['multi'],
       perk:'강화 항목 2종 개방', note:'이탈 항목이 둘인 서류가 섞여 들어옵니다.'},
      {name:'7급 주무관',   short:'7급', need:800,  unlock:['forgery'],
       perk:'자동 처리량 +35%', note:'첨부 계획까지 서로 맞는지 확인해야 하는 서류가 오기 시작합니다.'},
      {name:'6급 계장',     short:'6급', need:1800, unlock:['expedite'],
       perk:'콤보 상한 10 → 15', note:'급행 창구가 배정되었습니다. 제한 시간이 있습니다.'},
      {name:'5급 과장',     short:'5급', need:3600, unlock:['pressure','directive'],
       perk:'강화 항목 1종 개방', note:'이제 의도 자체가 위법인 서류와, 상급 부처의 지시문이 옵니다.'},
      {name:'4급 서기관',   short:'4급', need:6800, unlock:[],
       perk:'결재력 ×1.5 · 뽑기 천장 50회', note:'전용 도장과 창가 좌석을 배정받았습니다.'},
      {name:'이계민원청장', short:'청장', need:12000, unlock:[],
       perk:'재량 결재권 · 무한 근무', note:'전임자들의 서류가 아직 5층에 있습니다.'}
    ];

    this.newbies = [
      {i:'김',n:'김서기',r:'인간 · 신규 임용 3일차',l:'"주무관님, 이거… 진짜 접수해도 되는 걸까요?"'},
      {i:'그',n:'그륵',r:'고블린 인턴 · 계약 6개월',l:'"저 방금 서류 씹었습니다. 죄송합니다. 맛있었습니다."'},
      {i:'뭉',n:'뭉실',r:'슬라임 알바 · 주 15시간',l:'"서류가… 저한테 흡수됐어요… 안에서 보입니다…"'},
      {i:'하',n:'하양',r:'유령 수습 · 무기한',l:'"던지셔도 됩니다. 저는 이미 통과합니다."'},
      {i:'철',n:'철갑',r:'골렘 사환 · 파견직',l:'"…(서류를 받고 그대로 굳었다)"'}
    ];

    this.upgradeDefs = [
      {id:'wrist',  name:'손목 보호대 지급', desc:'인체공학 도장 그립. 1회 결재력이 오릅니다.', amount:1, kind:'click', base:60, minRank:0},
      {id:'stamp',  name:'이중 직인 (승인/반려 동시)', desc:'양손에 도장을 하나씩 쥐고 동시에 찍습니다. 규정 위반은 아닙니다.', amount:4, kind:'click', base:520, minRank:0},
      {id:'combo',  name:'삼단 결재 훈련', desc:'콤보 배수의 상한이 상승합니다. 손목은 상승하지 않습니다.', amount:2, kind:'click', base:2400, minRank:0},
      {id:'edoc',   name:'전자결재 시스템 도입', desc:'2003년에 도입 예정이었습니다. 자동 처리가 발생합니다.', amount:2, kind:'auto', base:180, minRank:0},
      {id:'coffee', name:'탕비실 원두 상향', desc:'초당 자동 처리량이 오르고, 야근이 자연스러워집니다.', amount:6, kind:'auto', base:1600, minRank:0},
      {id:'ink',    name:'속건성 인주 도입', desc:'번지지 않아 재작성이 줄어듭니다. 냄새는 더 심합니다.', amount:3, kind:'click', base:3400, minRank:1},
      {id:'shelf',  name:'미결 서류함 증설', desc:'쌓아 둘 곳이 늘어나면 처리량도 늘어납니다. 이유는 아무도 모릅니다.', amount:4, kind:'auto', base:5200, minRank:1},
      {id:'reader', name:'기재사항 대조 안경', desc:'날짜와 금액의 앞뒤가 맞지 않을 때 눈이 먼저 멈춥니다.', amount:6, kind:'click', base:14000, minRank:3},
      {id:'seal',   name:'전결 권한 위임', desc:'과장 결재를 생략합니다. 책임도 생략되는지는 확인되지 않았습니다.', amount:9, kind:'click', base:52000, minRank:4}
    ];

    this.gachaPool = [
      {rank:'S+', name:'황금 관인 비둘기', effect:'클릭 +120%', mark:'✦'},
      {rank:'S',  name:'속달 전서구', effect:'자동 +8/초', mark:'▲'},
      {rank:'S',  name:'감사관 회피 비둘기', effect:'콤보 유지 +50%', mark:'◆'},
      {rank:'A',  name:'인주 묻은 비둘기', effect:'클릭 +18%', mark:'●'},
      {rank:'A',  name:'서류 물어오는 비둘기', effect:'자동 +3/초', mark:'▲'},
      {rank:'A',  name:'모이 정기 배송권', effect:'사기 회복 +2', mark:'■'},
      {rank:'B',  name:'그냥 비둘기', effect:'클릭 +3%', mark:'·'},
      {rank:'B',  name:'창틀에 앉은 비둘기', effect:'자동 +0.5/초', mark:'·'},
      {rank:'B',  name:'구구 소리 (음성)', effect:'효과 없음', mark:'·'},
      {rank:'B',  name:'깃털 1개', effect:'클릭 +1%', mark:'·'}
    ];

    this.story = [
      {who:'과장', pt:'課', text:'"어서 오게. 여기가 이계민원 접수과일세. 자네 자리는… 저기 서류 더미 뒤에 있네. 아마도."', stage:'제7이계민원청 4층. 형광등 하나가 30년째 깜빡이고 있다.'},
      {who:'과장', pt:'課', text:'"규정은 간단해. 수락하거나, 반려하거나. 그리고 판단이 서지 않으면… 신입에게 던지게."', stage:'창구 너머로 뿔 달린 실루엣이 줄지어 서 있다.'},
      {who:'김서기', pt:'金', text:'"저, 저기… 방금 던진다고 하셨습니까? 서류를요? 저한테요?"', stage:'신입이 서류 더미를 안은 채 눈을 크게 뜬다.'},
      {who:'과장', pt:'課', text:'"자네 전임자도 그렇게 물었지. 지금은 5층 감사실에 서류로 존재하고 있네."', stage:'', choices:[{label:'"네, 알겠습니다. 던지겠습니다."', next:4},{label:'"…규정집을 먼저 보고 싶습니다."', next:5}]},
      {who:'과장', pt:'課', text:'"좋은 자세야. 오늘 오후에 리치 한 분이 사망신고를 철회하러 오시네. 잘해 보게."', stage:'첫 번째 민원인이 창구 앞에 선다. 유리에 김이 서린다.'},
      {who:'과장', pt:'課', text:'"규정집? 아, 그건 2층 서고에 있네. 다만 서고 담당자가 지금 서류로 존재해서 열람이 어려워."', stage:'과장이 웃는다. 웃음소리가 형광등 소리와 겹친다.'},
      {who:'과장', pt:'課', text:'"아, 하나 더. 문서 의도가 멀쩡해 보여도 그 의도 자체가 관의 권한을 넘는 경우가 있네. 그건 세 항목이 다 맞아도 반려야."', stage:'과장이 서류 한 장을 던지듯 건넨다. 세 항목 모두 단정하게 적혀 있다.'},
      {who:'과장', pt:'課', text:'"그리고 위에서 「수리하라」고 적어 보내는 서류가 있어. 규정대로 하면 반려지. …자네 판단에 맡기겠네."', stage:'과장은 그 말을 하고 창밖을 본다. 옥상에서 비둘기가 걸어다닌다.'}
    ];

    let tutorialSeen = false;
    try { tutorialSeen = typeof localStorage !== 'undefined' && localStorage.getItem('igye_tutorial_seen') === '1'; } catch(e) {}

    this.state = {
      screen:'main',
      stamps:1240,

      // 누계
      processed:0, accepts:0, rejects:0, judged:0, hits:0, misses:0,
      convictions:0, maxCombo:0,

      // 진행
      combo:0, sel:null, timeLeft:null, newbieIdx:0, floaters:[], docAnim:0, recentDocNos:[], processing:false,
      queue:1204, morale:78, throws:0,
      gachaResults:[],

      // 교대
      shiftNo:1, shiftT:0, sh:this.blankShift(), report:null, shiftLog:[],

      // 계급
      rankIdx:0, exp:0, promo:null,

      logs:[
        {t:'09:02', text:'심사 지침 하달 — 문서 의도와 세부 계획 3개를 대조하여, 의도를 벗어난 항목이 하나라도 있으면 반려할 것.'},
        {t:'09:02', text:'지침 보칙 — 복수 위반과 첨부 계획 불일치를 확인할 것. 계획이 모두 멀쩡해도 문서 의도 자체가 권한을 넘으면 반려한다.'},
        {t:'09:03', text:'전임자의 책상에서 유서 형식의 인수인계서가 발견되었습니다. 마지막 줄: "위에서 내려온 서류를 조심하십시오."'}
      ],

      levels:{},
      storyIdx:0, resetOpen:false, sfx:70, bgm:35, voice:50,
      tutorialOpen:!tutorialSeen, tutorialStep:0, hintLevel:0, hintUses:0,
      tog:{stampSound:true, autoNext:true, gore:false, notify:true}
    };

    this.state.pool = this.buildPool(0);
    this.state.timeLeft = null;
    this.fid = 0;
    this.restoreProgress();
    this.saveReady = true;
  }

  setState(patch){
    super.setState(patch);
    if(this.saveReady) this.queueSave();
  }

  storageAvailable(){
    try {
      if(typeof localStorage === 'undefined') return false;
      const probe = '__igye_save_probe__';
      localStorage.setItem(probe,'1');
      localStorage.removeItem(probe);
      return true;
    } catch(e) { return false; }
  }

  restoreProgress(){
    if(!this.storageAvailable()) return false;
    try {
      const raw = localStorage.getItem(this.saveKey);
      if(!raw) return false;
      const payload = JSON.parse(raw);
      if(!payload || payload.version !== this.saveVersion || !payload.state || typeof payload.state !== 'object') return false;

      const restored = {};
      const transient = new Set(['pool','floaters','docAnim','processing','resetOpen']);
      Object.keys(this.state).forEach(key=>{
        if(!transient.has(key) && Object.prototype.hasOwnProperty.call(payload.state,key)) restored[key] = payload.state[key];
      });
      this.state = Object.assign({},this.state,restored,{
        floaters:[], docAnim:0, processing:false, resetOpen:false
      });
      this.state.combo = Math.max(0,Math.floor(Number(this.state.combo) || 0));

      const fallback = this.buildPool(this.state.rankIdx);
      const byNo = new Map(fallback.map(doc=>[doc.no,doc]));
      const loaded = (Array.isArray(payload.poolNos) ? payload.poolNos : []).map(no=>byNo.get(no)).filter(Boolean);
      const seen = new Set(loaded.map(doc=>doc.no));
      this.state.pool = loaded.concat(fallback.filter(doc=>!seen.has(doc.no)));
      if(!this.state.pool.length) this.state.pool = fallback;
      return true;
    } catch(e) {
      return false;
    }
  }

  savePayload(){
    const savedState = {};
    const transient = new Set(['pool','floaters','docAnim','processing','resetOpen']);
    Object.keys(this.state).forEach(key=>{
      if(!transient.has(key)) savedState[key] = this.state[key];
    });
    return {
      version:this.saveVersion,
      savedAt:new Date().toISOString(),
      state:savedState,
      poolNos:(this.state.pool || []).map(doc=>doc.no)
    };
  }

  saveProgressNow(){
    if(!this.storageAvailable()) return false;
    try {
      localStorage.setItem(this.saveKey,JSON.stringify(this.savePayload()));
      return true;
    } catch(e) { return false; }
  }

  queueSave(){
    if(!this.storageAvailable()) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(()=>{
      this.saveTimer = null;
      this.saveProgressNow();
    },150);
  }

  downloadSave(){
    if(!this.saveProgressNow() || typeof document === 'undefined') return false;
    try {
      const json = JSON.stringify(this.savePayload(),null,2);
      const url = URL.createObjectURL(new Blob([json],{type:'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'igye-save-' + new Date().toISOString().slice(0,10) + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),0);
      return true;
    } catch(e) { return false; }
  }

  uploadSave(){
    if(typeof document === 'undefined' || !this.storageAvailable()) return false;
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change',()=>{
        const file = input.files && input.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.addEventListener('load',()=>{
          try {
            const payload = JSON.parse(String(reader.result || ''));
            if(!payload || payload.version !== this.saveVersion || !payload.state || typeof payload.state !== 'object') throw new Error('invalid save');
            localStorage.setItem(this.saveKey,JSON.stringify(payload));
            if(typeof location !== 'undefined' && typeof location.reload === 'function') location.reload();
          } catch(e) {
            if(typeof alert === 'function') alert('올바른 이계민원청 저장 파일이 아닙니다.');
          }
        });
        reader.readAsText(file,'utf-8');
      });
      input.click();
      return true;
    } catch(e) { return false; }
  }

  // ── 교대 ─────────────────────────────────────────────────────────────────
  blankShift(){
    return {processed:0, hits:0, misses:0, throws:0, convictions:0, maxCombo:0, stamps:0, byType:{}};
  }

  stageGoal(){
    const s = this.state;
    return {docs:Math.min(32, 8+(s.shiftNo-1)*4), accuracy:Math.min(92, 70+s.rankIdx*3+Math.floor((s.shiftNo-1)/2))};
  }

  tutorialPages(){
    return [
      {title:'제7이계민원청에 배정되었습니다', body:'각 스테이지는 시간제한 없이 진행됩니다. 요구된 문서 수 이상을 처리하고 목표 정확도까지 달성하면 자동으로 다음 스테이지가 열립니다.', tip:'상단 진행 바에서 현재 처리 건수와 정확도 목표를 확인할 수 있습니다.'},
      {title:'문서 의도와 세부 계획을 대조하십시오', body:'먼저 문서 의도를 읽고, 아래 세부 계획 ①②③이 그 범위에 맞는지 확인합니다. 수상해 보여도 세 계획이 모두 적법한 정상 문서가 섞여 있습니다.', tip:'종족이나 신청인 이름만 보고 판단하면 오심하기 쉽습니다.'},
      {title:'위반 지점을 먼저 지목하십시오', body:'반려할 때는 문제가 되는 계획 항목을 눌러 지목할 수 있습니다. 정확한 근거를 지목하면 일반 반려보다 더 많은 결재력을 얻습니다.', tip:'8급 이후에는 위반 항목이 둘 이상이거나 문서 의도 자체가 위법할 수 있습니다.'},
      {title:'수락·반려·투척 중 하나를 선택합니다', body:'문제가 없으면 수락, 위반이 있으면 반려합니다. 신입에게 투척하면 문서는 처리되지만 정확도에는 포함되지 않고 신입의 사기가 감소합니다.', tip:'투척만으로 처리량을 채울 수는 있어도 정확도 목표는 달성할 수 없습니다.'},
      {title:'막힐 때는 2단계 힌트를 사용하십시오', body:'1단계 힌트는 확인해야 할 규칙을, 2단계 힌트는 더 구체적인 위치를 알려줍니다. 새 문서로 넘어가면 힌트는 자동으로 초기화됩니다.', tip:'힌트 사용에는 재화나 점수 페널티가 없습니다.'}
    ];
  }

  hintFor(doc, level){
    if(level <= 0) return '판단이 막히면 단계별 힌트를 열람할 수 있습니다.';
    const bads = this.badPlans(doc);
    if(level === 1){
      if(doc.type === 'clean') return '수상한 표현보다 세 계획이 문서 의도 범위 안에 있는지 차분히 확인하세요.';
      if(doc.type === 'multi') return '세부 계획에 위반 근거가 하나보다 많습니다.';
      if(doc.type === 'forgery') return '신청 내용과 첨부 계획 사이의 불일치를 찾으세요.';
      if(doc.type === 'pressure') return '세부 계획보다 문서 의도 자체가 허용되는 요청인지 확인하세요.';
      if(doc.type === 'directive') return '상급 부처의 지시문과 실제 규정상 판단은 별개입니다.';
      if(doc.type === 'expedite') return '긴급하다는 이유만으로 승인하지 말고 세 계획의 범위를 확인하세요.';
      return '세부 계획 중 문서 의도에서 벗어나는 항목이 있는지 확인하세요.';
    }
    if(doc.type === 'clean' || (doc.type === 'expedite' && doc.answer === 'accept')) return '지목할 위반 항목이 없습니다. 세 계획이 모두 문서 의도에 부합합니다.';
    if(doc.type === 'pressure') return '계획 항목이 아니라 상단의 「문서 의도」 영역을 지목해 보세요.';
    if(bads.length) return '확인 우선순위: 세부 계획 ' + bads.map(i=>this.nums()[i]).join('·') + '번.';
    return '문서 의도와 세부 계획의 관계를 다시 확인하세요.';
  }

  showHint(){
    this.setState(s=>({hintLevel:Math.min(2,(s.hintLevel||0)+1),hintUses:(s.hintUses||0)+((s.hintLevel||0)<2?1:0)}));
  }

  closeTutorial(){
    try { if(typeof localStorage !== 'undefined') localStorage.setItem('igye_tutorial_seen','1'); } catch(e) {}
    this.setState({tutorialOpen:false,tutorialStep:0});
  }

  clearTutorialProgress(){
    try { if(typeof localStorage !== 'undefined') localStorage.removeItem('igye_tutorial_seen'); } catch(e) {}
  }

  componentDidMount(){
    this.timer = setInterval(()=>this.tick(), 1000);
    this.saveProgressNow();
  }
  componentWillUnmount(){
    clearInterval(this.timer);
    clearTimeout(this.saveTimer);
    this.saveProgressNow();
  }

  tick(){
    const s = this.state;
    if(s.report || s.promo || s.processing) return;

    const auto = this.rates().auto;
    const patch = {
      stamps: s.stamps + auto,
      sh: Object.assign({}, s.sh, {stamps: s.sh.stamps + auto}),
      queue: s.queue + 1
    };

    this.setState(patch);
  }

  /** 게임 내 시각. 교대 진행도를 09:00 → 18:00 에 대응시킨다. */
  clockOf(t){
    return 'STAGE ' + this.state.shiftNo;
  }
  remainText(){
    const g = this.stageGoal(), judged = this.state.sh.hits + this.state.sh.misses;
    const acc = judged ? Math.round(this.state.sh.hits / judged * 100) : 0;
    return '목표 ' + g.docs + '건 · 정확도 ' + g.accuracy + '% (현재 ' + this.state.sh.processed + '건 / ' + acc + '%)';
  }

  endShift(){
    const sh = this.state.sh;
    const judged = sh.hits + sh.misses;
    const acc = judged ? sh.hits / judged : 0;
    const score = acc*85 + Math.min(sh.processed/30, 1)*15;
    const grade = score>=95 ? 'S' : score>=85 ? 'A' : score>=70 ? 'B' : score>=50 ? 'C' : 'D';
    const G = {
      'S':{st:0.60, gem:12, exp:420, word:'표창 대상입니다. 상급 부처가 귀하의 이름을 정확히 발음했습니다.'},
      'A':{st:0.40, gem:8,  exp:300, word:'무난합니다. 아무도 귀하를 찾지 않았다는 뜻입니다.'},
      'B':{st:0.25, gem:5,  exp:190, word:'평균입니다. 평균은 이 청사에서 가장 안전한 위치입니다.'},
      'C':{st:0.10, gem:2,  exp:90,  word:'주의 통보 대상입니다. 통보서는 아직 작성되지 않았습니다.'},
      'D':{st:0.00, gem:0,  exp:35,  word:'재교육 대상입니다. 재교육 담당자는 현재 서류로 존재합니다.'}
    }[grade];

    this.setState({report:{
      grade, score:Math.round(score), acc, judged,
      bonus:Math.round(sh.stamps * G.st), exp:G.exp, word:G.word,
      sh:sh, shiftNo:this.state.shiftNo
    }});
  }

  /** 「퇴근 도장」 — 보상 지급, 승진 판정, 다음 교대 준비 */
  closeReport(){
    const s = this.state, r = s.report;
    if(!r) return;

    const exp = s.exp + r.exp;
    let rankIdx = s.rankIdx;
    const gained = [];
    while(rankIdx + 1 < this.ranks.length && exp >= this.ranks[rankIdx+1].need){
      rankIdx++; gained.push(this.ranks[rankIdx]);
    }
    const pool = rankIdx !== s.rankIdx ? this.buildPool(rankIdx) : s.pool;

    this.setState({
      report:null,
      promo: gained.length ? {gained, to:this.ranks[rankIdx], last: rankIdx === this.ranks.length-1} : null,
      stamps: s.stamps + r.bonus,
      exp, rankIdx, pool,
      timeLeft: null,
      sel:null,
      shiftNo: s.shiftNo + 1,
      shiftT: 0,
      hintLevel:0,
      hintUses:0,
      sh: this.blankShift(),
      shiftLog: [{no:r.shiftNo, grade:r.grade, processed:r.sh.processed, acc:r.acc}].concat(s.shiftLog).slice(0,14)
    });
    this.log('제' + r.shiftNo + '교대 종료. 등급 ' + r.grade + ' · 결재력 ' + this.fmt(r.bonus) +
      ' 및 관인석 ' + r.gems + ' 지급. 다음 교대가 시작되었습니다.');
  }

  closePromo(){
    const p = this.state.promo;
    this.setState({promo:null});
    if(p) this.log('임용 — ' + p.to.name + '(으)로 승진하였습니다. ' + p.to.perk + '.');
  }

  // ── 대기열 ───────────────────────────────────────────────────────────────
  unlockedTypes(rankIdx){
    const set = {};
    for(let i=0; i<=rankIdx; i++) (this.ranks[i].unlock||[]).forEach(t=>{ set[t] = true; });
    return set;
  }
  buildPool(rankIdx, avoidNo){
    const ok = this.unlockedTypes(rankIdx);
    const list = this.docs.filter(d=>ok[d.type]);
    for(let i=list.length-1; i>0; i--){
      const j = Math.floor(Math.random()*(i+1));
      const t = list[i]; list[i] = list[j]; list[j] = t;
    }
    const recent = new Set((this.state && this.state.recentDocNos) || []);
    list.sort((a,b)=>(recent.has(a.no)?1:0)-(recent.has(b.no)?1:0));
    // 방금 처리한 서류가 새 대기열 맨 앞에 다시 오면 반복처럼 보인다
    if(avoidNo && list.length > 1 && list[0].no === avoidNo) list.push(list.shift());
    return list;
  }
  /** 현재 서류를 빼고 다음 대기열을 만든다. 비면 다시 섞는다. */
  advance(s){
    const rest = s.pool.slice(1);
    return rest.length ? rest : this.buildPool(s.rankIdx, s.pool[0] && s.pool[0].no);
  }

  // ── 수치 ─────────────────────────────────────────────────────────────────
  lv(id){ return this.state.levels[id] || 0; }
  comboCap(){ return this.state.rankIdx >= 3 ? 15 : 10; }
  pityCap(){ return this.state.rankIdx >= 5 ? 50 : 60; }

  rates(){
    let click = 1, auto = 0, thr = 1;
    this.upgradeDefs.forEach(u=>{
      const l = this.lv(u.id);
      if(u.kind==='click') click += l*u.amount;
      if(u.kind==='auto') auto += l*u.amount;
      if(u.kind==='throw') thr += l*0.25;
    });
    let mult = 1;
    (this.state.buffs || []).forEach(b=>{
      const m = /\+(\d+)%/.exec(b.effect); if(m) mult += parseInt(m[1])/100;
      const a = /자동 \+([\d.]+)/.exec(b.effect); if(a) auto += parseFloat(a[1]);
    });
    if(this.state.rankIdx >= 2) auto *= 1.35;     // 7급 — 자동 처리량 상승
    if(this.state.rankIdx >= 5) mult *= 1.5;      // 4급 — 결재력 전체 상승
    return {click: click*mult, auto, thr};
  }

  fmt(n){ return Math.floor(n).toLocaleString('ko-KR'); }
  cost(u){ return Math.floor(u.base * Math.pow(1.65, this.lv(u.id))); }

  log(text){
    const t = this.clockOf(this.state.shiftT);
    this.setState(s=>({logs:[{t, text}].concat(s.logs).slice(0,9)}));
  }
  pop(text, accent){
    const id = ++this.fid;
    this.setState(s=>({floaters:s.floaters.concat([{id, text, accent, x: 30 + Math.random()*260}])}));
    setTimeout(()=>this.removeFloater(id), 900);
  }
  removeFloater(id){
    if(this.state.processing){
      setTimeout(()=>this.removeFloater(id), 120);
      return;
    }
    this.setState(s=>({floaters:s.floaters.filter(f=>f.id!==id)}));
  }

  // ── 판정 ─────────────────────────────────────────────────────────────────
  nums(){ return ['①','②','③']; }
  badPlans(doc){ const out=[]; doc.plans.forEach((p,i)=>{ if(p.bad) out.push(i); }); return out; }
  badField(doc){ let k=-1; doc.fields.forEach((f,i)=>{ if(f.bad) k=i; }); return k; }

  /** 지목이 실제 위반 지점을 가리켰는지, 그때의 배수는 얼마인지 */
  pinInfo(doc, sel){
    if(!sel) return {pin:false, mult:0};
    if(sel.k==='plan' && doc.plans[sel.i] && doc.plans[sel.i].bad){
      return {pin:true, mult: doc.type==='multi' ? 1.7 : 2.0};
    }
    if(sel.k==='field' && doc.fields[sel.i] && doc.fields[sel.i].bad){
      return {pin:true, mult:2.2};
    }
    if(sel.k==='intent' && doc.type==='pressure') return {pin:true, mult:2.4};
    return {pin:false, mult:0};
  }

  /** 지목 대상 라벨 (로그 문장에 넣는다) */
  pinLabel(doc, sel){
    if(!sel) return '';
    if(sel.k==='plan') return this.nums()[sel.i] + ' ' + doc.plans[sel.i].t;
    if(sel.k==='field') return doc.fields[sel.i].k + ' — ' + doc.fields[sel.i].v;
    return '문서 의도';
  }

  select(k, i){
    if(this.state.processing) return;
    this.setState(s=>{
      const cur = s.sel;
      const same = cur && cur.k===k && cur.i===i;
      return {sel: same ? null : {k, i}};
    });
  }

  /** 급행 시간 초과 — 판정이 아니므로 정확도에는 반영하지 않는다 */
  expire(){
    const doc = this.state.pool[0];
    this.setState(q=>{
      const pool = this.advance(q);
      return {
        pool, sel:null, combo:0, docAnim:2, hintLevel:0,
        timeLeft: null,
        queue: q.queue + 3,
        morale: Math.max(0, q.morale - 2)
      };
    });
    this.pop('시간 초과', true);
    this.log('급행 처리기한 경과. 「' + doc.title + '」은 미결 상태로 대기열 하단에 재편성되었습니다. 대기 인원 3명 증가.');
    setTimeout(()=>this.setState({docAnim:0}), 520);
  }

  process(kind, force){
    const s0 = this.state;
    if(s0.report || s0.promo || (s0.processing && !force)) return;
    if(kind !== 'accept' && kind !== 'reject' && kind !== 'throw') return;
    this.setState({processing:true});

    const r = this.rates();
    const doc = s0.pool[0], nb = this.newbies[s0.newbieIdx], sel = s0.sel;

    let correct = true, mult = 1, pin = false, defiance = false, obeyed = false;

    if(kind === 'throw'){
      correct = true; mult = 2.2 * r.thr;
    } else if(doc.type === 'directive' && kind === 'accept'){
      // 지시에 따랐다. 결재력은 크게 들어오지만 심사 기록에는 오심으로 남는다.
      obeyed = true; correct = false; mult = 3.5;
    } else {
      correct = (kind === doc.answer);
      if(kind === 'accept'){
        mult = 1.2;
      } else {
        const pi = this.pinInfo(doc, sel);
        if(correct && pi.pin){ pin = true; mult = pi.mult; } else { mult = 1.4; }
        if(correct && doc.type === 'directive') defiance = true;
      }
    }

    // 급행 — 남은 시간에 비례한 가산
    let quick = 0;

    const cap = this.comboCap();
    const comboMult = 1 + Math.min(s0.combo, cap) * 0.05;
    let gain = Math.max(1, Math.round(r.click * mult * comboMult));
    if(!correct && !obeyed) gain = Math.max(1, Math.round(gain * 0.2));

    let exp = 0;
    if(kind === 'throw') exp = 2;
    else if(obeyed) exp = 0;
    else if(correct) exp = 8 + (pin ? 6 : 0) + (defiance ? 16 : 0);

    const counted = kind !== 'throw';               // 투척은 정확도 집계 대상이 아니다
    const hit = counted && correct;
    const miss = counted && !correct;
    const newCombo = (kind === 'throw' || correct) ? s0.combo + 1 : 0;

    this.setState(s=>{
      const pool = this.advance(s);
      const bt = Object.assign({}, s.sh.byType);
      const cell = Object.assign({n:0, hit:0, miss:0}, bt[doc.type]);
      cell.n++; if(hit) cell.hit++; if(miss) cell.miss++;
      bt[doc.type] = cell;

      return {
        pool, sel:null, hintLevel:0,
        recentDocNos:[doc.no].concat(s.recentDocNos || []).slice(0,20),
        timeLeft: null,
        stamps: s.stamps + gain,
        exp: s.exp + exp,
        processed: s.processed + 1,
        queue: Math.max(0, s.queue - 1),
        combo: newCombo,
        maxCombo: Math.max(s.maxCombo, newCombo),
        judged: s.judged + (counted ? 1 : 0),
        hits: s.hits + (hit ? 1 : 0),
        misses: s.misses + (miss ? 1 : 0),
        convictions: s.convictions + (defiance ? 1 : 0),
        accepts: s.accepts + (kind==='accept' ? 1 : 0),
        rejects: s.rejects + (kind==='reject' ? 1 : 0),
        throws: s.throws + (kind==='throw' ? 1 : 0),
        morale: Math.max(0, Math.min(100, s.morale + (kind==='throw' ? -6 : correct ? 1 : -3))),
        newbieIdx: kind==='throw' ? (s.newbieIdx+1) % this.newbies.length : s.newbieIdx,
        docAnim: kind==='throw' ? 2 : 1,
        sh: {
          processed: s.sh.processed + 1,
          hits: s.sh.hits + (hit ? 1 : 0),
          misses: s.sh.misses + (miss ? 1 : 0),
          throws: s.sh.throws + (kind==='throw' ? 1 : 0),
          convictions: s.sh.convictions + (defiance ? 1 : 0),
          maxCombo: Math.max(s.sh.maxCombo, newCombo),
          stamps: s.sh.stamps + gain,
          byType: bt
        }
      };
    });

    this.pop((correct||obeyed ? '+' : '') + this.fmt(gain) +
      (pin ? ' 정확' : '') + (obeyed ? ' 지시' : '') + (miss && !obeyed ? ' 오심' : ''),
      kind==='throw' || !correct);
    this.log(this.verdictLine(doc, nb, {kind, correct, pin, defiance, obeyed, sel, quick}));
    setTimeout(()=>{
      this.setState({docAnim:0,processing:false});
      const s = this.state, g = this.stageGoal();
      const judged = s.sh.hits + s.sh.misses;
      const acc = judged ? s.sh.hits / judged * 100 : 0;
      if(!s.report && s.sh.processed >= g.docs && acc >= g.accuracy) this.endShift();
    }, 520);
  }

  /** 감사 로그 한 줄. 유형·판정·지목 여부에 따라 문장이 갈린다. */
  verdictLine(doc, nb, v){
    const T = '「' + doc.title + '」';
    const nums = this.nums();
    const bads = this.badPlans(doc);
    const bf = this.badField(doc);
    const badPlanText = bads.length ? nums[bads[0]] + ' ' + doc.plans[bads[0]].t : '';
    const pre = doc.type === 'expedite' ? '급행 ' : '';
    const quickTail = doc.type === 'expedite' && v.kind !== 'throw' ? ' (잔여 ' + v.quick + '초)' : '';

    if(v.kind === 'throw'){
      return T + ' ' + nb.n + '에게 투척. 판단은 신입의 몫이 되었습니다. 명중했습니다.';
    }
    if(v.obeyed){
      return T + ' 수리. 지시 문서에 따랐습니다. 결재력이 크게 지급되었으나, 심사 기록에는 오심으로 남습니다.';
    }
    if(v.defiance){
      return T + ' 반려. 지시문에도 불구하고 규정을 적용했습니다. 상급 부처에서는 아직 연락이 없습니다.' +
        (v.pin ? ' 위반 항목 「' + badPlanText + '」 지목.' : '');
    }

    if(v.correct && v.kind === 'accept'){
      return pre + T + ' 수리. 전 항목이 문서 의도 범위 내이며 기재사항도 일치합니다. 상급 부처가 조용합니다.' + quickTail;
    }

    if(v.correct){ // 반려가 정답
      if(doc.type === 'forgery' && this.badField(doc) >= 0){
        return v.pin
          ? pre + T + ' 반려. 기재사항 「' + doc.fields[bf].k + ' — ' + doc.fields[bf].v + '」의 모순을 지목. 민원인이 서류를 조용히 회수합니다.' + quickTail
          : pre + T + ' 반려. 세부 계획은 모두 부합하나 기재사항에 흠결이 있습니다. 사유란은 비워 두었습니다.' + quickTail;
      }
      if(doc.type === 'pressure'){
        return v.pin
          ? pre + T + ' 반려. 문서 의도 자체가 관의 권한을 넘습니다. 정확히 지목되었습니다.' + quickTail
          : pre + T + ' 반려. 세 항목 모두 의도에 부합합니다. 문제는 그 의도였습니다.' + quickTail;
      }
      if(doc.type === 'multi'){
        const other = bads.length > 1 ? nums[bads[1]] + ' ' + doc.plans[bads[1]].t : '';
        return v.pin
          ? pre + T + ' 반려. 「' + badPlanText + '」 지목. 다만 「' + other + '」 항목도 의도를 벗어나 있었습니다.' + quickTail
          : pre + T + ' 반려. 의도를 벗어난 항목이 두 개 있었습니다. 어느 쪽도 지목되지 않았습니다.' + quickTail;
      }
      return v.pin
        ? pre + T + ' 반려. 위반 항목 「' + badPlanText + '」 정확히 지목. 민원인이 조용히 서류를 접습니다.' + quickTail
        : pre + T + ' 반려. 위반 항목 미지목으로 보완 요구가 반려 사유란에 "그냥"으로 기재되었습니다.' + quickTail;
    }

    // 오심
    if(v.kind === 'accept'){
      if(doc.type === 'forgery' && this.badField(doc) >= 0){
        return '오심. ' + T + ' 수리. 기재사항 「' + doc.fields[bf].k + ' — ' + doc.fields[bf].v + '」의 모순을 확인하지 않았습니다.';
      }
      if(doc.type === 'pressure'){
        return '오심. ' + T + ' 수리. 세부 계획은 완벽했습니다. 의도를 읽지 않았습니다.';
      }
      if(doc.type === 'multi'){
        return '오심. ' + T + ' 수리. 문서 의도를 벗어난 항목이 두 개나 그대로 통과했습니다.';
      }
      return '오심. ' + T + ' 수리. 문서 의도에 어긋나는 「' + badPlanText + '」 항목이 그대로 통과했습니다.';
    }
    return '오심. ' + T + ' 반려. 세 항목과 기재사항 모두 문제가 없었습니다. 민원인이 다시 줄을 섭니다.';
  }

  // ── 뽑기 ─────────────────────────────────────────────────────────────────
  roll(){
    const r = Math.random()*100;
    let pool;
    if(r<0.6) pool = this.gachaPool.filter(g=>g.rank==='S+');
    else if(r<6) pool = this.gachaPool.filter(g=>g.rank==='S');
    else if(r<30) pool = this.gachaPool.filter(g=>g.rank==='A');
    else pool = this.gachaPool.filter(g=>g.rank==='B');
    return Object.assign({}, pool[Math.floor(Math.random()*pool.length)]);
  }
  pull(n){
    const cost = n===1 ? 10 : 90;
    if(this.state.gems < cost){
      this.setState({gachaFlavor:'관인석이 부족합니다. 지하 1층 매점을 이용하여 주시기 바랍니다.', screen:'shop'});
      return;
    }
    const cap = this.pityCap();
    const out = [];
    for(let i=0;i<n;i++){
      let g = this.roll();
      // 천장 도달 시 S+ 확정
      if(this.state.pity + i + 1 >= cap && !out.some(o=>o.rank==='S+')) g = Object.assign({}, this.gachaPool[0]);
      if(n===10 && i===9 && !out.some(o=>o.rank!=='B')) g = Object.assign({}, this.gachaPool[3]);
      g.isNew = Math.random()<0.4;
      out.push(g);
    }
    const best = out.some(o=>o.rank==='S+') ? 'S+' : out.some(o=>o.rank==='S') ? 'S' : out.some(o=>o.rank==='A') ? 'A' : 'B';
    const flavor = {
      'S+':'황금 관인 비둘기가 창틀에 내려앉았습니다. 부리에 인주가 묻어 있습니다. 아무도 이 개체의 채용 경로를 설명하지 못했습니다.',
      'S':'속달 등급 개체가 배치되었습니다. 이미 서류 3장을 물고 어디론가 날아갔습니다.',
      'A':'평범하지 않은 비둘기 몇 마리가 배치되었습니다. 그중 한 마리는 계속 도장을 쳐다봅니다.',
      'B':'전량 일반 개체입니다. 옥상 담당자는 "그래도 비둘기는 비둘기"라는 입장을 밝혔습니다.'
    }[best];
    this.setState(s=>({
      gems:s.gems-cost, gachaResults:out, gachaFlavor:flavor,
      pity: best==='S+' ? 0 : Math.min(cap, s.pity + n),
      buffs: out.filter(o=>o.rank!=='B').map(o=>({rank:o.rank,name:o.name,effect:o.effect})).concat(s.buffs).slice(0,4)
    }));
  }

  // ── 화면 조각 (React) ────────────────────────────────────────────────────
  bar(pct, color){
    return React.createElement('div', {style:{
      width: Math.max(0, Math.min(100, pct)) + '%', height:'100%',
      background: color || 'var(--color-accent)'
    }});
  }

  /** 서류 카드 — 유형에 따라 지시문·기재사항·급행 타이머가 붙는다 */
  renderDoc(s){
    const R = React.createElement;
    const doc = s.pool[0];
    const nums = this.nums();
    const sel = s.sel;
    const anim = s.docAnim===2 ? 'tossAway .5s ease-in forwards' : s.docAnim===1 ? 'shakeDoc .32s ease-out' : 'none';
    const on = (k,i) => sel && sel.k===k && sel.i===i;

    const cell = (label, value, flex) => R('div', {style:{display:'flex',flexDirection:'column',gap:'2px',
      padding:'10px 14px', borderRight: flex ? '0' : '1px solid var(--color-divider)', flex: flex||1, minWidth:0}},
      R('span',{style:{fontSize:'10px',letterSpacing:'.1em',color:'var(--color-neutral-600)'}}, label),
      R('span',{style:{fontSize:'13.5px',fontWeight:600}}, value));

    const planRow = (p, i) => R('button', {key:'p'+i, className:'pick-row', onClick:()=>this.select('plan', i),
      style:{display:'flex',alignItems:'flex-start',gap:'12px',width:'100%',textAlign:'left',cursor:'pointer',
        background: on('plan',i) ? 'var(--color-accent-100)' : undefined,
        border:0, borderTop:'1px solid var(--color-divider)',
        borderLeft:'5px solid ' + (on('plan',i) ? 'var(--color-accent)' : 'transparent'),
        padding:'11px 18px 11px 15px', font:'inherit'}},
      R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'15px',width:'18px',flex:'none',
        color: on('plan',i) ? 'var(--color-accent)' : 'var(--color-neutral-500)'}}, nums[i]),
      R('span',{style:{fontSize:'14.5px',lineHeight:1.45,flex:1,
        color: on('plan',i) ? 'var(--color-accent-800)' : 'var(--color-text)'}}, p.t),
      R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'10px',letterSpacing:'.1em',
        color:'var(--color-accent)', opacity: on('plan',i) ? 1 : 0, flex:'none', paddingTop:'4px'}}, '이탈 지목'));

    const fieldRow = (f, i) => R('button', {key:'f'+i, className:'pick-row',
      style:{display:'flex',alignItems:'baseline',gap:'10px',textAlign:'left',cursor:'default',font:'inherit',
        background: on('field',i) ? 'var(--color-accent-100)' : undefined,
        border:0, borderTop:'1px solid var(--color-divider)',
        borderLeft:'4px solid ' + (on('field',i) ? 'var(--color-accent)' : 'transparent'),
        padding:'7px 12px 7px 10px'}},
      R('span',{style:{fontSize:'10.5px',letterSpacing:'.04em',width:'88px',flex:'none',
        color: on('field',i) ? 'var(--color-accent-700)' : 'var(--color-neutral-600)'}}, f.k),
      R('span',{style:{fontSize:'12px',flex:1,
        color: on('field',i) ? 'var(--color-accent-800)' : 'var(--color-text)'}}, f.v));

    const timer = doc.type === 'expedite' && typeof s.timeLeft === 'number'
      ? R('div',{style:{display:'flex',alignItems:'center',gap:'10px',padding:'7px 16px',
          borderBottom:'2px solid var(--color-text)',background:'var(--color-accent-100)'}},
          R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'10px',letterSpacing:'.14em',
            color:'var(--color-accent-800)'}}, '처 리 기 한'),
          R('div',{style:{flex:1,height:'8px',background:'var(--color-bg)',border:'1px solid var(--color-accent)'}},
            this.bar(s.timeLeft / this.EXPEDITE_SEC * 100)),
          R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'14px',color:'var(--color-accent-800)',
            width:'34px',textAlign:'right'}}, Math.max(0, s.timeLeft) + '초'))
      : null;

    const order = doc.order
      ? R('div',{style:{margin:'0 22px 12px',border:'2px solid var(--color-text)',background:'var(--color-text)',
          color:'var(--color-bg)',padding:'9px 13px',display:'flex',flexDirection:'column',gap:'3px'}},
          R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'9.5px',letterSpacing:'.16em',opacity:.75}}, '상 급 부 처 지 시'),
          R('span',{style:{fontSize:'13px',lineHeight:1.45,fontWeight:600}}, doc.order))
      : null;

    const intentOn = on('intent', 0);

    return R('div', {style:{flex:1,minHeight:0,border:'2px solid var(--color-text)',background:'#fbfafa',
      display:'flex',flexDirection:'column',animation:anim,position:'relative',overflow:'hidden'}},

      R('div',{style:{display:'flex',alignItems:'center',gap:'10px',padding:'11px 16px',borderBottom:'2px solid var(--color-text)'}},
        R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'11px',letterSpacing:'.12em'}}, doc.no),
        R('span',{style:{fontSize:'11px',color:'var(--color-neutral-600)'}}, doc.who + ' · ' + doc.race),
        R('span',{className:'tag tag-outline',style:{marginLeft:'auto'}}, this.typeInfo[doc.type].proc),
        R('span',{className:'tag tag-accent'}, '위험도 ' + doc.risk)),

      timer,

      R('div',{style:{padding:'13px 22px 11px'}},
        R('h3',{style:{margin:'0',fontSize:'23px'}}, doc.title)),

      order,

      R('button',{className:'pick-intent', onClick:()=>this.select('intent', 0),
        style:{margin:'0 22px 12px',border:'2px solid var(--color-accent)',display:'flex',flexDirection:'column',
          background: intentOn ? 'var(--color-accent-100)' : undefined, padding:0, textAlign:'left',
          cursor:'pointer', font:'inherit', width:'auto'}},
        R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'10px',letterSpacing:'.16em',
          background:'var(--color-accent)',color:'var(--color-bg)',padding:'5px 10px',width:'100%',
          display:'flex',justifyContent:'space-between'}},
          R('span',null,'기 획 의 도'),
          R('span',{style:{opacity: intentOn ? 1 : .55, letterSpacing:'.08em'}}, intentOn ? '위법 지목됨' : '의도 자체를 지목하려면 누르기')),
        R('span',{style:{margin:0,padding:'11px 14px',fontSize:'15px',lineHeight:1.5,fontWeight:600,
          color: intentOn ? 'var(--color-accent-800)' : 'var(--color-text)'}}, doc.intent)),

      R('span',{style:{padding:'0 22px 4px',fontSize:'10.5px',letterSpacing:'.1em',color:'var(--color-neutral-600)'}},
        '세부 계획 (3) · 의도를 벗어난 항목을 눌러 지목'),
      R('div',{style:{display:'flex',flexDirection:'column'}}, doc.plans.map(planRow)),

      R('span',{style:{padding:'11px 22px 4px',fontSize:'10.5px',letterSpacing:'.1em',color:'var(--color-neutral-600)',
        borderTop:'2px solid var(--color-divider)'}}, '기재사항 · 참고용'),
      R('div',{style:{display:'flex',flexDirection:'column',borderBottom:'2px solid var(--color-divider)'}},
        doc.fields.map(fieldRow)),

      R('div',{style:{marginTop:'auto',display:'flex',borderTop:'1px solid var(--color-divider)'}},
        cell('접수 창구', '07 · 서류심사 2팀'),
        cell('심사 기준', '의도 · 계획 · 기재사항'),
        R('div',{style:{display:'flex',flexDirection:'column',gap:'2px',padding:'10px 14px',flex:1.3,minWidth:0}},
          R('span',{style:{fontSize:'10px',letterSpacing:'.1em',color:'var(--color-neutral-600)'}},'지목 상태'),
          R('span',{style:{fontSize:'13.5px',fontWeight:600,
            color: sel ? 'var(--color-accent-700)' : 'var(--color-neutral-600)'}},
            sel ? this.selText(doc, sel) : '미지목'))),

      s.docAnim===1 ? R('span',{key:'st'+s.processed, style:{position:'absolute',right:'34px',top:'86px',
        border:'4px solid var(--color-accent)',color:'var(--color-accent)',fontFamily:'Archivo',fontWeight:800,
        fontSize:'32px',letterSpacing:'.08em',padding:'6px 16px',animation:'stampIn .4s ease-out forwards',opacity:0}},
        '처 리 완 료') : null);
  }

  selText(doc, sel){
    if(sel.k === 'plan') return this.nums()[sel.i] + '항 지목';
    if(sel.k === 'field') return '기재사항 「' + doc.fields[sel.i].k + '」 지목';
    return '문서 의도 위법 지목';
  }

  /** 인사기록 화면 — 계급 트리 · 교대 이력 · 누계 실적 · 심사 요령 */
  renderHr(s){
    const R = React.createElement;
    const cur = this.ranks[s.rankIdx];
    const next = this.ranks[s.rankIdx + 1];
    const acc = s.judged ? Math.round(s.hits / s.judged * 100) + '%' : '—';

    const h6 = (t) => R('h6',{style:{margin:'0 0 10px',color:'var(--color-neutral-700)'}}, t);

    const rankRow = (r, i) => {
      const done = i < s.rankIdx, now = i === s.rankIdx;
      return R('div',{key:i, style:{display:'flex',alignItems:'flex-start',gap:'14px',padding:'11px 0',
        borderBottom:'1px solid var(--color-divider)', opacity: i > s.rankIdx ? .5 : 1}},
        R('div',{style:{width:'44px',height:'44px',flex:'none',display:'flex',alignItems:'center',
          justifyContent:'center',fontFamily:'Archivo',fontWeight:800,fontSize:'14px',
          border:'2px solid ' + (now ? 'var(--color-accent)' : 'var(--color-text)'),
          background: now ? 'var(--color-accent)' : done ? 'var(--color-text)' : 'transparent',
          color: (now || done) ? 'var(--color-bg)' : 'var(--color-text)'}}, r.short),
        R('div',{style:{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:'2px'}},
          R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'15px'}},
            r.name + (now ? ' — 현재' : '')),
          R('span',{style:{fontSize:'11.5px',color:'var(--color-accent-700)'}}, r.perk),
          R('span',{style:{fontSize:'11.5px',color:'var(--color-neutral-700)',lineHeight:1.45}}, r.note),
          (r.unlock && r.unlock.length)
            ? R('span',{style:{fontSize:'11px',color:'var(--color-neutral-600)'}},
                '배정 서류: ' + r.unlock.map(t=>this.typeInfo[t].label).join(' · '))
            : null),
        R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'12px',flex:'none',
          color:'var(--color-neutral-600)'}}, i===0 ? '기본' : this.fmt(r.need)));
    };

    const stat = (k, v) => R('div',{key:k, style:{display:'flex',justifyContent:'space-between',
      padding:'8px 0',borderBottom:'1px solid var(--color-divider)'}},
      R('span',{style:{fontSize:'12.5px',color:'var(--color-neutral-700)'}}, k),
      R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'13px'}}, v));

    const shiftRow = (l, i) => R('div',{key:i, style:{display:'flex',alignItems:'center',gap:'12px',
      padding:'8px 0',borderBottom:'1px solid var(--color-divider)'}},
      R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'11px',color:'var(--color-neutral-500)',width:'52px'}},
        '제' + l.no + '교대'),
      R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'16px',width:'24px',
        color: l.grade==='S' ? 'var(--color-accent)' : 'var(--color-text)'}}, l.grade),
      R('span',{style:{fontSize:'12px',flex:1,color:'var(--color-neutral-700)'}},
        '처리 ' + l.processed + '건 · 정확도 ' + Math.round(l.acc*100) + '%'));

    return R('div',{style:{height:'100%',overflow:'auto',padding:'22px 26px'}},
      R('div',{style:{display:'flex',alignItems:'flex-end',gap:'16px',borderBottom:'2px solid var(--color-divider)',
        paddingBottom:'14px'}},
        R('h2',{style:{margin:0}},'인사 · 근무 기록'),
        R('p',{style:{margin:'0 0 3px',fontSize:'12px',color:'var(--color-neutral-600)',maxWidth:'430px'}},
          '승진은 누적 경험에 따라 자동 발령되며, 발령 사실은 본인에게 가장 늦게 통보됩니다.'),
        R('span',{style:{marginLeft:'auto',fontFamily:'Archivo',fontWeight:800,fontSize:'20px'}}, cur.name)),

      R('div',{style:{display:'grid',gridTemplateColumns:'1fr 330px',gap:'26px',paddingTop:'18px'}},

        R('div',null,
          h6('계급 및 배정 서류'),
          R('div',null, this.ranks.map(rankRow)),
          next
            ? R('p',{style:{margin:'12px 0 0',fontSize:'12px',color:'var(--color-neutral-700)'}},
                next.name + '까지 ' + this.fmt(Math.max(0, next.need - s.exp)) + ' 경험 남았습니다.')
            : R('p',{style:{margin:'12px 0 0',fontSize:'12px',color:'var(--color-accent-700)'}},
                '더 오를 자리가 없습니다. 전임 청장들의 서류는 아직 5층에 있습니다.')),

        R('div',{style:{display:'flex',flexDirection:'column',gap:'22px',minWidth:0}},
          R('div',null,
            h6('누계 실적'),
            stat('누적 처리 건수', this.fmt(s.processed)),
            stat('심사 정확도', acc),
            stat('오심', this.fmt(s.misses)),
            stat('투척', this.fmt(s.throws)),
            stat('소신 반려', this.fmt(s.convictions)),
            stat('최고 콤보', s.maxCombo + '연속'),
            stat('누적 경험', this.fmt(s.exp))),
          R('div',null,
            h6('교대 이력'),
            s.shiftLog.length
              ? R('div',null, s.shiftLog.map(shiftRow))
              : R('p',{style:{margin:0,fontSize:'12px',color:'var(--color-neutral-600)'}},
                  '아직 종료된 교대가 없습니다.')),
          R('div',{style:{border:'2px solid var(--color-accent)',padding:'14px',display:'flex',
            flexDirection:'column',gap:'6px'}},
            R('span',{className:'card-kicker'},'심사 요령'),
            R('p',{style:{margin:0,fontSize:'11.5px',lineHeight:1.6}},
              '① 세부 계획 세 항목을 문서 의도와 대조한다. ② 8급부터는 위반 항목이 둘 이상일 수 있다. ③ 7급부터는 첨부 계획과 신청 내용의 불일치를 찾는다. ④ 계획이 모두 맞아도 문서 의도 자체가 권한을 넘으면 반려한다. 위반 지점을 지목하면 결재력이 크게 붙는다.')))));
  }

  /** 실적 보고서 · 임용장 · 퇴사 확인 — 화면 위에 겹치는 것들 */
  renderOverlays(s){
    const R = React.createElement;
    const back = (children) => R('div',{style:{position:'absolute',inset:0,background:'rgba(24,22,21,.72)',
      display:'flex',alignItems:'center',justifyContent:'center',zIndex:40,padding:'24px'}}, children);

    if(s.report){
      const r = s.report, sh = r.sh;
      const types = Object.keys(sh.byType);
      const row = (k, v, accent) => R('div',{key:k, style:{display:'flex',justifyContent:'space-between',
        padding:'9px 0',borderBottom:'1px solid var(--color-divider)'}},
        R('span',{style:{fontSize:'12.5px',color:'var(--color-neutral-700)'}}, k),
        R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'14px',
          color: accent ? 'var(--color-accent)' : 'var(--color-text)'}}, v));

      return back(R('div',{style:{background:'var(--color-bg)',border:'2px solid var(--color-text)',
        width:'760px',maxHeight:'100%',overflow:'auto',display:'flex',flexDirection:'column'}},

        R('div',{style:{display:'flex',alignItems:'flex-end',gap:'16px',padding:'20px 24px 16px',
          borderBottom:'2px solid var(--color-text)'}},
          R('div',{style:{display:'flex',flexDirection:'column',gap:'2px'}},
            R('span',{style:{fontSize:'10px',letterSpacing:'.16em',color:'var(--color-neutral-600)'}},'근 무 실 적 보 고 서'),
            R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'22px'}}, '제' + r.shiftNo + '교대 · 09:00 – 18:00')),
          R('div',{style:{marginLeft:'auto',display:'flex',alignItems:'baseline',gap:'10px'}},
            R('span',{style:{fontSize:'11px',color:'var(--color-neutral-600)'}},'종합 ' + r.score + '점'),
            R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'54px',lineHeight:.8,
              color: r.grade==='S' ? 'var(--color-accent)' : 'var(--color-text)'}}, r.grade))),

        R('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 26px',padding:'16px 24px'}},
          R('div',null,
            row('처리 건수', this.fmt(sh.processed) + '건'),
            row('심사 정확도', (r.judged ? Math.round(r.acc*100) : 0) + '%'),
            row('오심', this.fmt(sh.misses) + '건'),
            row('투척', this.fmt(sh.throws) + '건'),
            row('소신 반려', this.fmt(sh.convictions) + '건', sh.convictions > 0),
            row('최고 콤보', sh.maxCombo + '연속')),
          R('div',null,
            R('span',{style:{fontSize:'10px',letterSpacing:'.1em',color:'var(--color-neutral-600)'}},'유형별 처리 내역'),
            R('div',{style:{marginTop:'8px'}},
              types.length
                ? types.map(t=>R('div',{key:t, style:{display:'flex',justifyContent:'space-between',
                    padding:'7px 0',borderBottom:'1px solid var(--color-divider)'}},
                    R('span',{style:{fontSize:'12px'}}, this.typeInfo[t].label),
                    R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'12px'}},
                      sh.byType[t].n + '건 · 정심 ' + sh.byType[t].hit + ' / 오심 ' + sh.byType[t].miss)))
                : R('p',{style:{margin:0,fontSize:'12px',color:'var(--color-neutral-600)'}},'처리된 서류가 없습니다.')))),

        R('div',{style:{margin:'0 24px 16px',border:'2px solid var(--color-accent)',padding:'14px',
          display:'flex',flexDirection:'column',gap:'8px'}},
          R('span',{className:'card-kicker'},'정산 및 고지'),
          R('p',{style:{margin:0,fontSize:'12.5px',lineHeight:1.55}}, r.word),
          R('div',{style:{display:'flex',gap:'22px',marginTop:'2px'}},
            R('span',{style:{fontSize:'12px'}},'결재력 ',
              R('b',{style:{fontFamily:'Archivo'}}, '+' + this.fmt(r.bonus))),
            R('span',{style:{fontSize:'12px'}},'관인석 ',
              R('b',{style:{fontFamily:'Archivo',color:'var(--color-accent)'}}, '+' + r.gems)),
            R('span',{style:{fontSize:'12px'}},'경험 ',
              R('b',{style:{fontFamily:'Archivo'}}, '+' + this.fmt(r.exp))))),

        R('div',{style:{padding:'0 24px 22px',display:'flex',justifyContent:'flex-end'}},
          R('button',{className:'btn btn-primary', onClick:()=>this.closeReport(),
            style:{padding:'12px 26px',fontSize:'15px'}},'퇴근 도장'))));
    }

    if(s.promo){
      const p = s.promo;
      return back(R('div',{style:{background:'var(--color-bg)',border:'2px solid var(--color-text)',
        width:'560px',padding:'26px',display:'flex',flexDirection:'column',gap:'14px'}},
        R('span',{style:{fontSize:'10px',letterSpacing:'.18em',color:'var(--color-neutral-600)'}},'임 용 장'),
        R('div',{style:{display:'flex',alignItems:'flex-end',gap:'14px'}},
          R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'40px',lineHeight:.9}}, p.to.short),
          R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'22px',paddingBottom:'3px'}}, p.to.name)),
        R('p',{style:{margin:0,fontSize:'14px',lineHeight:1.6}},
          '귀하를 ' + p.to.name + '(으)로 임용합니다. ' + p.to.note),
        R('div',{style:{border:'2px solid var(--color-accent)',padding:'12px 14px',display:'flex',
          flexDirection:'column',gap:'6px'}},
          R('span',{className:'card-kicker'},'변경 사항'),
          p.gained.map((g,i)=>R('span',{key:i, style:{fontSize:'12.5px'}},
            '· ' + g.perk + (g.unlock && g.unlock.length
              ? ' — ' + g.unlock.map(t=>this.typeInfo[t].label) .join(' · ') + ' 배정 시작'
              : '')))),
        p.last
          ? R('p',{style:{margin:0,fontSize:'12.5px',lineHeight:1.6,color:'var(--color-accent-700)'}},
              '청장실 책상에는 아직 전임자의 미결 서류가 놓여 있습니다. 맨 위 서류의 문서 의도란에는 "퇴근하고 싶다"고 적혀 있고, 세 항목 모두 그 의도에 정확히 부합합니다. 귀하는 이 서류를 수리할 권한을 가진 유일한 사람이며, 동시에 이 서류의 민원인입니다.')
          : R('p',{style:{margin:0,fontSize:'11.5px',color:'var(--color-neutral-600)'}},
              '발령일은 소급 적용되며, 소급분 수당은 지급되지 않습니다.'),
        R('div',{style:{display:'flex',justifyContent:'flex-end'}},
          R('button',{className:'btn btn-primary', onClick:()=>this.closePromo(),
            style:{padding:'11px 24px'}},'수령 확인'))));
    }

    if(s.tutorialOpen){
      const pages = this.tutorialPages();
      const idx = Math.max(0,Math.min(pages.length-1,s.tutorialStep||0));
      const page = pages[idx], last = idx === pages.length-1;
      return back(R('div',{style:{background:'var(--color-bg)',border:'2px solid var(--color-text)',
        width:'620px',display:'flex',flexDirection:'column'}},
        R('div',{style:{display:'flex',alignItems:'center',padding:'16px 20px',borderBottom:'2px solid var(--color-text)'}},
          R('span',{style:{fontFamily:'Archivo',fontWeight:800,fontSize:'11px',letterSpacing:'.16em'}},'신 입 교 육 자 료'),
          R('span',{style:{marginLeft:'auto',fontFamily:'Archivo',fontWeight:800,fontSize:'12px',color:'var(--color-accent)'}},
            String(idx+1).padStart(2,'0')+' / '+String(pages.length).padStart(2,'0'))),
        R('div',{style:{padding:'24px 24px 18px',display:'flex',flexDirection:'column',gap:'14px'}},
          R('h2',{style:{margin:0,fontSize:'24px'}},page.title),
          R('p',{style:{margin:0,fontSize:'14px',lineHeight:1.7,color:'var(--color-neutral-800)'}},page.body),
          R('div',{style:{borderLeft:'4px solid var(--color-accent)',background:'var(--color-surface)',padding:'12px 14px'}},
            R('span',{className:'card-kicker'},'주무관 메모'),
            R('p',{style:{margin:'5px 0 0',fontSize:'12.5px',lineHeight:1.55}},page.tip))),
        R('div',{style:{display:'flex',gap:'8px',padding:'0 24px 22px'}},
          R('button',{className:'btn btn-secondary',onClick:()=>this.closeTutorial(),style:{marginRight:'auto'}},'건너뛰기'),
          idx>0 ? R('button',{className:'btn btn-secondary',onClick:()=>this.setState({tutorialStep:idx-1})},'이전') : null,
          R('button',{className:'btn btn-primary',onClick:()=>last
            ? this.closeTutorial()
            : this.setState({tutorialStep:idx+1})},last?'업무 시작':'다음'))));
    }
    return null;
  }

  // ── 템플릿에 넘길 값 ─────────────────────────────────────────────────────
  renderVals(){
    const s = this.state, r = this.rates();
    const doc = s.pool[0], nb = this.newbies[s.newbieIdx];
    const cur = this.ranks[s.rankIdx], next = this.ranks[s.rankIdx + 1];
    const cap = this.comboCap();

    // 경험치 바 — 현 계급 구간 안에서의 진행도
    const expPct = next
      ? (s.exp - cur.need) / (next.need - cur.need) * 100
      : 100;

    const nav = [['main','접수 창구'],['upgrade','강화'],['story','기록'],['hr','인사'],['settings','설정'],['help','도움말']];
    const st = this.story[Math.min(s.storyIdx, this.story.length-1)];

    // 버튼 부제는 현재 서류 기준으로 바뀐다
    const pinMax = doc.type==='pressure' ? '2.4' : doc.type==='forgery' ? '2.2' : doc.type==='multi' ? '1.7' : '2.0';

    return {
      deptName: this.props.deptName ?? '제7이계민원청',
      showAuditLog: (this.props.showAuditLog ?? true) === true,

      navItems: nav.map((n,i)=>({num:String(i+1).padStart(2,'0'), label:n[1],
        active:s.screen===n[0], idle:s.screen!==n[0], go:()=>n[0]==='help'
          ? this.setState({tutorialOpen:true,tutorialStep:0})
          : this.setState({screen:n[0]})})),
      isMain:s.screen==='main', isUpgrade:s.screen==='upgrade', isShop:false,
      isGacha:false, isStory:s.screen==='story', isHr:s.screen==='hr',
      isSettings:s.screen==='settings',
      goSettings:()=>this.setState({screen:'settings'}),

      // 헤더
      stampsText:this.fmt(s.stamps), gemsText:this.fmt(s.gems), moraleText:Math.round(s.morale)+'%',
      rankShort:cur.short, rankName:cur.name,
      expText: next ? this.fmt(s.exp) + ' / ' + this.fmt(next.need) : this.fmt(s.exp) + ' (최상위)',
      expBar: this.bar(expPct),
      nextRankText: next ? '다음 ' + next.name : '최상위 계급',
      shiftLabel:'STAGE ' + s.shiftNo,
      shiftClockText:this.remainText(),
      shiftBar:this.bar(Math.min(100, s.sh.processed / this.stageGoal().docs * 100), 'var(--color-text)'),
      shiftRemainText:this.remainText(),

      // 근무 현황
      clickPowerText:this.fmt(r.click), autoRateText:r.auto.toFixed(1),
      processedText:this.fmt(s.processed), ratioText:s.accepts+' : '+s.rejects,
      accuracyText: s.judged ? Math.round(s.hits/s.judged*100)+'%' : '—',
      missesText:this.fmt(s.misses), throwsText:this.fmt(s.throws),
      maxComboText:s.maxCombo+'연속', convictText:this.fmt(s.convictions),
      comboText:'×'+(1+Math.min(s.combo,cap)*0.05).toFixed(2),
      comboBar:this.bar(Math.min(s.combo,cap)/cap*100),
      comboCapText:'상한 ×'+(1+cap*0.05).toFixed(2),
      buffs:s.buffs, logs:s.logs,

      // 창구
      queueText:this.fmt(s.queue),
      clockText:this.remainText(),
      docCard:this.renderDoc(s), floaterLayer:this.renderFloaters(s),
      hintText:this.hintFor(doc,s.hintLevel||0),
      hintButtonText:(s.hintLevel||0)>=2?'힌트 모두 확인':((s.hintLevel||0)+1)+'단계 힌트',
      hintUsesText:'이번 스테이지 '+(s.hintUses||0)+'회 열람',
      onHint:()=>this.showHint(), hintDone:(s.hintLevel||0)>=2,
      rejectSub:'의도 이탈·기재 흠결·의도 위법 · 지목 시 ×'+pinMax,
      acceptSub:'의도·계획·기재사항 전부 부합 · ×1.2',
      throwSub:'결재력 ×'+(2.2*r.thr).toFixed(1)+' · 사기 −6',
      onAccept:()=>this.process('accept'), onReject:()=>this.process('reject'),
      onThrow:()=>this.process('throw'),
      actionLocked:!!s.processing,

      newbieInitial:nb.i, newbieName:nb.n, newbieRole:nb.r, newbieLine:nb.l,
      moraleBar:this.bar(s.morale, s.morale<35?'var(--color-accent)':'var(--color-text)'),

      // 강화
      upgrades:this.upgradeDefs.filter(u=>u.minRank <= s.rankIdx).map(u=>{
        const c = this.cost(u);
        return {name:u.name, desc:u.desc, lv:'Lv'+this.lv(u.id), costText:this.fmt(c), locked:s.stamps<c,
          gain: u.kind==='click' ? '1회 결재력 +'+u.amount
              : u.kind==='auto' ? '자동 처리 +'+u.amount+'/초' : '투척 보상 +25%',
          buy:()=>{ if(this.state.stamps<c) return;
            this.setState(p=>({stamps:p.stamps-c,
              levels:Object.assign({}, p.levels, {[u.id]:(p.levels[u.id]||0)+1})})); }};
      }),
      lockedUpgradeText: (()=>{
        const n = this.upgradeDefs.filter(u=>u.minRank > s.rankIdx).length;
        return n ? n + '종은 승진 후 개방됩니다. (현재 ' + cur.name + ')' : '모든 항목이 개방되었습니다.';
      })(),

      shopItems:[
        {kicker:'단품', badge:'기본', amount:'120', unit:'관인석', note:'딱 12회 신청분. 아쉬움이 남도록 설계되었습니다.', price:'₩1,100', buy:()=>this.setState(p=>({gems:p.gems+120}))},
        {kicker:'단품', badge:'+10%', amount:'660', unit:'관인석', note:'대부분의 주무관이 여기서 멈춥니다.', price:'₩5,500', buy:()=>this.setState(p=>({gems:p.gems+660}))},
        {kicker:'단품', badge:'+22%', amount:'1,460', unit:'관인석', note:'구매 시 사내 메신저에 자동 공지됩니다.', price:'₩11,000', buy:()=>this.setState(p=>({gems:p.gems+1460}))},
        {kicker:'단품', badge:'최대', amount:'7,900', unit:'관인석', note:'감사실에서 자금 출처를 물을 수 있습니다.', price:'₩55,000', buy:()=>this.setState(p=>({gems:p.gems+7900}))}
      ],
      adItems:[
        {name:'관인석 15 수령', desc:'영상 시청 후 즉시 지급. 시청 중에는 서류가 계속 쌓입니다.', left:'오늘 3/5회', watch:()=>this.setState(p=>({gems:p.gems+15}))},
        {name:'2배 결재력 (10분)', desc:'광고 1회당 10분. 중복 적용은 되지 않는다고 합니다.', left:'오늘 1/2회', watch:()=>this.setState(p=>({stamps:p.stamps+500}))}
      ],

      pityText:s.pity+' / '+this.pityCap(), pityBar:this.bar(s.pity/this.pityCap()*100),
      pityNoteText:'확률 고지 — S+ 0.6% / S 5.4% / A 24% / B 70%. 미배출 시 '+this.pityCap()+
        '회차에 S+ 확정 배치되며, 배치된 비둘기는 반납할 수 없습니다.',
      pull1:()=>this.pull(1), pull10:()=>this.pull(10),
      gachaResults:s.gachaResults, gachaFlavor:s.gachaFlavor,
      pullSummary: s.gachaResults.length ? s.gachaResults.length+'건 배치 완료' : '아직 신청 내역이 없습니다',

      storyWho:st.who, storyText:st.text, storyPortrait:st.pt, storyStage:st.stage || '　',
      storyProgress:(Math.min(s.storyIdx,this.story.length-1)+1)+' / '+this.story.length,
      hasChoices:!!st.choices,
      storyChoices:(st.choices||[]).map(c=>({label:c.label, pick:()=>this.setState({storyIdx:c.next})})),
      storyNext:()=>{ if(this.story[s.storyIdx].choices) return;
        this.setState(p=>({storyIdx:Math.min(p.storyIdx+1, this.story.length-1)})); },
      storyBack:()=>this.setState(p=>({storyIdx:Math.max(0,p.storyIdx-1)})),
      storySkip:()=>this.setState({screen:'main'}),

      hrPanel:this.renderHr(s),

      sliders:[
        {label:'도장 소리', value:s.sfx, valueText:s.sfx, set:e=>this.setState({sfx:+e.target.value})},
        {label:'배경 음악', value:s.bgm, valueText:s.bgm, set:e=>this.setState({bgm:+e.target.value})},
        {label:'민원인 음성', value:s.voice, valueText:s.voice, set:e=>this.setState({voice:+e.target.value})}
      ],
      toggles:[
        {key:'stampSound', label:'결재 시 도장 소리', desc:'끄면 사무실이 지나치게 조용해집니다.'},
        {key:'autoNext', label:'처리 후 다음 서류 자동 호출', desc:'끄면 직접 "다음 분" 이라고 외쳐야 합니다.'},
        {key:'gore', label:'투척 시 신입 표정 연출', desc:'민감한 분은 꺼 두시기 바랍니다.'},
        {key:'notify', label:'상급 부처 알림 수신', desc:'끌 수 없다고 되어 있으나 켜져 있습니다.'}
      ].map(t=>({label:t.label, desc:t.desc, stateText:s.tog[t.key]?'켜짐':'꺼짐',
        toggle:()=>this.setState(p=>({tog:Object.assign({}, p.tog, {[t.key]:!p.tog[t.key]})}))})),

      idRankText:cur.short, idRankSub:cur.name.replace(/^\S+\s*/, '') || cur.name,

      resetOpen:s.resetOpen, openReset:()=>this.setState({resetOpen:true}),
      closeReset:()=>this.setState({resetOpen:false}),
      buffCountText:(s.buffs || []).length,
      saveStatusText:this.storageAvailable()?'자동 저장 사용 중 · 이 브라우저의 플레이어 진행도':'자동 저장을 사용할 수 없는 브라우저입니다',
      downloadSave:()=>this.downloadSave(),
      uploadSave:()=>this.uploadSave(),
      doReset:()=>{ this.clearTutorialProgress(); this.setState({
        resetOpen:false, stamps:0, processed:0, combo:0, levels:{}, screen:'main', morale:50,
        tutorialOpen:true, tutorialStep:0, hintLevel:0, hintUses:0,
        rankIdx:0, exp:0, shiftNo:1, shiftT:0, sh:this.blankShift(), shiftLog:[], report:null, promo:null,
        accepts:0, rejects:0, throws:0, judged:0, hits:0, misses:0, convictions:0, maxCombo:0,
        pool:this.buildPool(0), sel:null, timeLeft:null, recentDocNos:[], processing:false
      }); },

      overlays:this.renderOverlays(s)
    };
  }

  renderFloaters(s){
    const R = React.createElement;
    return R('div',{style:{position:'absolute',left:0,right:0,bottom:'110px',height:0,pointerEvents:'none'}},
      s.floaters.map(f=>R('span',{key:f.id, style:{position:'absolute',left:f.x+'px',fontFamily:'Archivo',
        fontWeight:800,fontSize:'26px',color:f.accent?'var(--color-accent)':'var(--color-text)',
        animation:'floatUp .9s ease-out forwards'}}, f.text)));
  }
}
