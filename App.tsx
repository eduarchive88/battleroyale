
import React, { useState, useEffect, useRef } from 'react';
import { network } from './services/p2pNetwork';
import { Role, ClassType, Player, Team, GameState, Quiz } from './types';
import { CLASS_BASE_STATS, SKILLS_INFO } from './constants';
import { GameCanvas } from './components/GameCanvas';
import { Joystick } from './components/Joystick';

const playSound = (type: 'attack' | 'skill' | 'quiz_ok' | 'quiz_no' | 'phase' | 'click' | 'victory') => {
  const sounds: Record<string, string> = {
    attack: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
    skill: 'https://assets.mixkit.co/active_storage/sfx/2581/2581-preview.mp3',
    quiz_ok: 'https://assets.mixkit.co/active_storage/sfx/1070/1070-preview.mp3',
    quiz_no: 'https://assets.mixkit.co/active_storage/sfx/1071/1071-preview.mp3',
    phase: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
    click: 'https://assets.mixkit.co/active_storage/sfx/2567/2567-preview.mp3',
    victory: 'https://assets.mixkit.co/active_storage/sfx/2020/2020-preview.mp3'
  };
  const audio = new Audio(sounds[type]);
  audio.volume = 0.4;
  audio.play().catch(() => {});
};

const App: React.FC = () => {
  const [view, setView] = useState<'landing' | 'host_setup' | 'host_lobby' | 'lobby' | 'game'>('landing');
  const [roomCode, setRoomCode] = useState('');
  const [userName, setUserName] = useState('');
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [quizList, setQuizList] = useState<Quiz[]>([]);
  const [newQuiz, setNewQuiz] = useState<Quiz>({ question: '', options: ['', '', '', ''], answer: 0 });
  const [pendingSelection, setPendingSelection] = useState<{ teamId: string, role: Role, classType?: ClassType } | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);

  const [gameState, setGameState] = useState<GameState>({
    isStarted: false,
    teams: {},
    players: {},
    quizzes: [],
    currentQuizIndex: 0,
    phase: 'QUIZ',
    timer: 30
  });

  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isHost) network.setActionListener((action: any) => handleHostAction(action));
  }, [isHost]);

  useEffect(() => {
    if (!isHost && gameState.isStarted && view === 'lobby') setView('game');
  }, [gameState.isStarted, isHost, view]);

  useEffect(() => {
    if (isHost && gameState.isStarted && gameState.phase !== 'GAME_OVER') {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setGameState(prev => {
          if (prev.timer <= 0) return proceedToNextPhase(prev);
          const now = Date.now();
          const newState = JSON.parse(JSON.stringify(prev)) as GameState;
          Object.values(newState.teams).forEach(t => {
            t.activeEffects = t.activeEffects.filter(e => e.until > now);
          });
          newState.timer = prev.timer - 1;
          network.broadcastState(newState);
          return newState;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isHost, gameState.isStarted, gameState.phase]);

  const proceedToNextPhase = (prev: GameState) => {
    if (prev.phase === 'BATTLE' && prev.currentQuizIndex >= prev.quizzes.length - 1) {
      playSound('victory');
      let winnerId = '';
      let maxScore = -1;
      Object.values(prev.teams).forEach(t => {
        if (t.isDead) return;
        const score = (t.totalDamageDealt || 0) * 0.5 + t.points + t.hp * 0.2;
        if (score > maxScore) { maxScore = score; winnerId = t.id; }
      });
      const endState: GameState = { ...prev, phase: 'GAME_OVER', winnerTeamId: winnerId };
      network.broadcastState(endState);
      return endState;
    }
    const nextPhase = prev.phase === 'QUIZ' ? 'BATTLE' : 'QUIZ';
    const nextQuizIdx = prev.phase === 'BATTLE' ? prev.currentQuizIndex + 1 : prev.currentQuizIndex;
    const newState = JSON.parse(JSON.stringify(prev)) as GameState;
    newState.phase = nextPhase;
    newState.currentQuizIndex = nextQuizIdx;
    newState.timer = 30;
    Object.keys(newState.players).forEach(k => newState.players[k].hasSubmittedQuiz = false);
    Object.values(newState.teams).forEach(t => {
      t.activeEffects = [];
      t.mp = Math.min(t.maxMp, t.mp + 20);
    });
    playSound('phase');
    network.broadcastState(newState);
    return newState;
  };

  const executeAttack = (newState: GameState, teamId: string) => {
    const t = newState.teams[teamId];
    if (!t || t.isDead) return;
    const now = Date.now();
    t.lastAtkTime = now;
    playSound('attack');
    const rangeMult = t.activeEffects.some(e => e.type === 'a_range') ? 2.5 : 1;
    const attackerAngleRad = t.angle * (Math.PI / 180);
    Object.values(newState.teams).forEach((target: any) => {
      if (target.id === t.id || target.isDead) return;
      const dx = target.x - t.x; const dy = target.y - t.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angleToTarget = Math.atan2(dy, dx);
      const angleDiff = Math.abs(angleToTarget - attackerAngleRad);
      const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      let isHit = (t.classType === ClassType.WARRIOR || t.classType === ClassType.ROGUE) 
        ? (dist < t.stats.range * rangeMult && Math.abs(normalizedDiff) < Math.PI / 3)
        : (dist < t.stats.range * rangeMult && Math.abs(normalizedDiff) < 0.25);
      if (isHit && !target.activeEffects.some((e: any) => e.type === 'w_invinc')) {
        const damage = Math.max(8, (t.stats.atk * (t.activeEffects.some(e => e.type === 'w_double') ? 2 : 1)) - target.stats.def);
        target.hp = Math.max(0, target.hp - damage);
        t.totalDamageDealt = (t.totalDamageDealt || 0) + damage;
        if (target.hp <= 0) target.isDead = true;
        t.points += 2;
      }
    });
  }

  const handleHostAction = (action: any) => {
    setGameState(prev => {
      let newState = JSON.parse(JSON.stringify(prev)) as GameState;
      const { type, payload } = action;
      const now = Date.now();

      switch (type) {
        case 'CONFIRM_SELECTION': {
          const { player } = payload;
          newState.players[player.id] = player;
          const classToUse = player.role === Role.COMBAT ? player.classType : ClassType.WARRIOR;
          const base = CLASS_BASE_STATS[classToUse];
          if (!newState.teams[player.teamId]) {
            newState.teams[player.teamId] = {
              id: player.teamId, name: `${player.teamId} 모둠`, points: 0,
              hp: base.hp, maxHp: base.hp, mp: base.mp, maxMp: base.mp,
              x: Math.random() * 800 + 100, y: Math.random() * 800 + 100, angle: 0,
              isDead: false, classType: classToUse, stats: { ...base },
              items: { weapon: false, armor: false, boots: false },
              unlockedSkills: [], activeEffects: [], skillCooldowns: {}, lastAtkTime: 0, totalDamageDealt: 0
            };
          } else if (player.role === Role.COMBAT) {
            newState.teams[player.teamId].classType = classToUse;
            newState.teams[player.teamId].hp = base.hp;
            newState.teams[player.teamId].maxHp = base.hp;
            newState.teams[player.teamId].stats = { ...base };
          }
          break;
        }
        case 'MOVE': {
          const t = newState.teams[payload.teamId];
          if (t && !t.isDead && newState.phase === 'BATTLE') {
            const speedMult = t.activeEffects.some(e => e.type === 'w_speed') ? 2 : 1;
            t.x = Math.max(0, Math.min(1000, t.x + payload.dir.x * t.stats.speed * 4 * speedMult));
            t.y = Math.max(0, Math.min(1000, t.y + payload.dir.y * t.stats.speed * 4 * speedMult));
            if (payload.dir.x !== 0 || payload.dir.y !== 0) t.angle = Math.atan2(payload.dir.y, payload.dir.x) * (180 / Math.PI);
          }
          break;
        }
        case 'ATTACK': {
          executeAttack(newState, payload.teamId);
          break;
        }
        case 'SUPPORT_ACTION': {
          const t = newState.teams[payload.teamId];
          if (!t || t.points < payload.cost || newState.phase === 'QUIZ') return newState;
          t.points -= payload.cost;
          playSound('click');
          if (payload.action === 'ITEM') {
            (t.items as any)[payload.item] = true;
            if (payload.item === 'weapon') t.stats.atk += 15;
            if (payload.item === 'armor') t.stats.def += 10;
            if (payload.item === 'boots') t.stats.speed += 1.5;
          } else if (payload.action === 'STAT') {
            if (payload.stat === 'hp') t.hp = Math.min(t.maxHp, t.hp + 60);
            if (payload.stat === 'mp') t.mp = Math.min(t.maxMp, t.mp + 60);
            if (payload.stat === 'revive') { t.isDead = false; t.hp = 80; }
            if (payload.stat === 'atk') t.stats.atk += 8;
            if (payload.stat === 'def') t.stats.def += 8;
          } else if (payload.action === 'SKILL') {
            if (!t.unlockedSkills.includes(payload.skillId)) t.unlockedSkills.push(payload.skillId);
          }
          break;
        }
        case 'SKILL_USE': {
          const t = newState.teams[payload.teamId];
          const skill = SKILLS_INFO[t.classType].find(s => s.id === payload.skId);
          if (!t || !skill || t.isDead || t.mp < skill.mp || newState.phase === 'QUIZ') return newState;
          if (now < (t.skillCooldowns[payload.skId] || 0)) return newState;
          t.mp -= skill.mp;
          t.skillCooldowns[payload.skId] = now + 5000;
          playSound('skill');
          
          if (skill.id === 'r_tele') {
            let closestTarget: any = null;
            let minDist = Infinity;
            Object.values(newState.teams).forEach(target => {
              if (target.id === t.id || target.isDead) return;
              const d = Math.sqrt((target.x - t.x)**2 + (target.y - t.y)**2);
              if (d < minDist) { minDist = d; closestTarget = target; }
            });
            if (closestTarget) {
              const rad = (closestTarget.angle * Math.PI) / 180;
              t.x = closestTarget.x - Math.cos(rad) * 40;
              t.y = closestTarget.y - Math.sin(rad) * 40;
              t.angle = closestTarget.angle;
              executeAttack(newState, t.id);
            }
          } else if (['w_speed', 'w_invinc', 'w_double', 'r_hide', 'a_range', 'm_laser', 'a_multi'].includes(skill.id)) {
            t.activeEffects.push({ type: skill.id, until: now + 2000 });
            if (skill.id === 'a_multi') {
                Object.values(newState.teams).forEach((target: any) => {
                    if (target.id === t.id || target.isDead) return;
                    const dx = target.x - t.x; const dy = target.y - t.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const angleToTarget = Math.atan2(dy, dx);
                    const diff = Math.abs(Math.atan2(Math.sin(angleToTarget - (t.angle * Math.PI/180)), Math.cos(angleToTarget - (t.angle * Math.PI/180))));
                    if (dist < 500 && diff < Math.PI / 3) {
                        target.hp = Math.max(0, target.hp - (t.stats.atk * 1.5));
                        if(target.hp===0) target.isDead=true;
                    }
                });
            }
          } else {
            t.activeEffects.push({ type: skill.id, until: now + 500 });
            if (skill.id === 'm_thunder') {
              Object.values(newState.teams).forEach((target: any) => {
                if (target.id === t.id || target.isDead) return;
                const dist = Math.sqrt((target.x - t.x)**2 + (target.y - t.y)**2);
                if (dist < 400) { target.hp = Math.max(0, target.hp - (t.stats.atk * 3.5)); if(target.hp===0) target.isDead=true; }
              });
            }
          }
          break;
        }
        case 'QUIZ_ANSWER': {
          const p = newState.players[payload.playerId];
          if (p && !p.hasSubmittedQuiz) {
            p.hasSubmittedQuiz = true;
            if (payload.correct) { newState.teams[payload.teamId].points += 6; playSound('quiz_ok'); }
            else { newState.teams[payload.teamId].points += 4; playSound('quiz_no'); }
          }
          break;
        }
        case 'SKIP_PHASE': return proceedToNextPhase(newState);
        case 'ADJUST_TIMER': newState.timer = Math.max(0, newState.timer + payload.amount); break;
      }
      network.broadcastState(newState);
      return newState;
    });
  };

  const createRoom = () => {
    if (!customCode) return alert("방 코드를 입력하세요.");
    if (quizList.length === 0) return alert("최소 1개 이상의 퀴즈가 필요합니다.");
    setIsConnecting(true);
    setIsHost(true);
    const initialGameState: GameState = {
      isStarted: false,
      teams: {},
      players: {},
      quizzes: quizList,
      roomCode: customCode.toUpperCase(),
      currentQuizIndex: 0,
      phase: 'QUIZ',
      timer: 30
    };
    network.init(customCode.toUpperCase(), true, setGameState, () => {
      setIsConnecting(false);
      setGameState(initialGameState);
      network.broadcastState(initialGameState);
      setView('host_lobby');
    });
  };

  const downloadCSVTemplate = () => {
    const header = "question,option1,option2,option3,option4,answer(1-4)\n";
    const example = "사과는 영어로?,Apple,Banana,Cherry,Date,1\n중세시대 기사의 주무기는?,활,지팡이,칼,방패,3";
    const blob = new Blob([header + example], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'quiz_template.csv';
    link.click();
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').slice(1);
      const loaded = lines.filter(l => l.trim()).map(line => {
        const parts = line.split(',');
        if (parts.length < 6) return null;
        return { question: parts[0].trim(), options: [parts[1], parts[2], parts[3], parts[4]].map(o => o.trim()), answer: (parseInt(parts[5].trim()) || 1) - 1 };
      }).filter((q): q is Quiz => q !== null);
      setQuizList(prev => [...prev, ...loaded]);
      alert(`${loaded.length}개의 퀴즈가 추가되었습니다.`);
    };
    reader.readAsText(file);
  };

  if (view === 'landing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#0a0a0a] text-amber-100 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
        <h1 className="text-8xl font-black italic text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-700 drop-shadow-[0_10px_10px_rgba(0,0,0,1)] animate-pulse mb-8">EDU ARENA</h1>
        <div className="w-full max-w-md p-8 bg-slate-900 border-double border-8 border-amber-900 shadow-2xl space-y-6">
          <input className="w-full p-4 bg-black border border-amber-900 font-bold text-amber-200 outline-none" placeholder="닉네임 입력" value={userName} onChange={e => setUserName(e.target.value)} />
          <input className="w-full p-4 bg-black border border-amber-900 font-black uppercase text-amber-200 outline-none" placeholder="코드 입력" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
          <button onClick={() => { if(!userName) return alert("닉네임을 입력하세요."); setIsConnecting(true); network.init(roomCode.toUpperCase(), false, setGameState, () => { setIsConnecting(false); setView('lobby'); }); }} className="w-full py-5 bg-amber-800 hover:bg-amber-700 border-4 border-amber-600 font-black text-2xl text-white active:scale-95 transition-all">게임 입장</button>
          <button onClick={() => setView('host_setup')} className="w-full py-2 text-amber-900 font-bold hover:text-amber-500 text-xs tracking-widest">교사용 방 만들기</button>
        </div>
      </div>
    );
  }

  if (view === 'host_setup') {
    return (
      <div className="flex flex-col h-screen bg-[#0a0a0a] text-amber-100 p-6 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] overflow-hidden">
        <div className="flex justify-between items-center mb-4 border-b-4 border-amber-900 pb-2">
          <h2 className="text-3xl font-black text-amber-600 italic">퀴즈 및 방 설정</h2>
          <button onClick={() => setView('landing')} className="text-amber-800 font-bold text-xs underline">뒤로가기</button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
          <div className="bg-slate-900 p-6 border-double border-8 border-amber-900 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
            <h3 className="text-xl font-black text-amber-500 border-b border-amber-900/50 pb-2">1. 퀴즈 만들기</h3>
            <input className="w-full p-3 bg-black border border-amber-900 text-amber-200 font-bold outline-none" placeholder="질문을 적어주세요" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} />
            <div className="space-y-2">
              {newQuiz.options.map((o, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input type="radio" name="ans" checked={newQuiz.answer === i} onChange={() => setNewQuiz({...newQuiz, answer: i})} className="w-5 h-5 accent-amber-500" />
                  <input className="flex-1 p-2 bg-black border border-amber-900 text-xs text-amber-200" placeholder={`보기 ${i+1}`} value={o} onChange={e => { const opts = [...newQuiz.options]; opts[i] = e.target.value; setNewQuiz({...newQuiz, options: opts}); }} />
                </div>
              ))}
            </div>
            <button onClick={() => { if(newQuiz.question) { setQuizList([...quizList, newQuiz]); setNewQuiz({question:'', options:['','','',''], answer:0}); } }} className="w-full py-3 bg-amber-800 font-black border-2 border-amber-600 text-white hover:bg-amber-700">퀴즈 추가</button>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={downloadCSVTemplate} className="py-2 bg-black border border-amber-900 text-[10px] text-amber-600 font-black">양식 받기</button>
              <button onClick={() => fileInputRef.current?.click()} className="py-2 bg-black border border-amber-900 text-[10px] text-amber-600 font-black">파일 올리기</button>
              <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleCSVUpload} />
            </div>
          </div>
          <div className="bg-slate-950 p-6 border-double border-8 border-amber-950 flex flex-col overflow-hidden">
            <h3 className="text-xl font-black mb-4 border-b-2 border-amber-900 pb-2 text-amber-700">추가된 퀴즈 ({quizList.length})</h3>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
              {quizList.map((q, i) => (
                <div key={i} className="p-3 bg-black border-l-4 border-amber-800 flex justify-between items-start">
                  <div className="text-xs font-bold text-amber-100"><span className="text-amber-900 mr-2">#{i+1}</span>{q.question}</div>
                  <button onClick={() => setQuizList(quizList.filter((_, idx) => idx !== i))} className="text-red-900 font-black text-[10px]">삭제</button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-6 flex gap-4">
          <input className="flex-1 p-4 bg-slate-900 border-4 border-amber-900 text-2xl font-black text-center text-amber-200 outline-none" placeholder="방 코드 (예: CLASS1)" value={customCode} onChange={e => setCustomCode(e.target.value)} />
          <button onClick={createRoom} className="px-10 bg-amber-800 border-4 border-amber-500 font-black text-xl text-white hover:bg-amber-700">전장 생성</button>
        </div>
      </div>
    );
  }

  if (view === 'host_lobby') {
    return (
      <div className="h-screen bg-[#0a0a0a] text-amber-100 flex flex-col p-8 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
        <div className="flex justify-between items-center mb-8 bg-slate-900 p-10 border-double border-8 border-amber-900 shadow-2xl">
          <div><p className="text-amber-700 text-sm font-black mb-1 tracking-widest">방 코드</p><h2 className="text-8xl font-mono font-black text-amber-200">{gameState.roomCode}</h2></div>
          <button onClick={() => { playSound('phase'); const ns = { ...gameState, isStarted: true }; setGameState(ns); network.broadcastState(ns); setView('game'); }} className="px-16 py-8 bg-amber-800 border-4 border-amber-500 font-black text-4xl text-white hover:bg-amber-700 shadow-lg">게임 시작</button>
        </div>
        <div className="grid grid-cols-3 gap-6 overflow-y-auto flex-1 custom-scrollbar">
          {[1,2,3,4,5,6,7,8,9].map(tId => {
            const teamPlayers = Object.values(gameState.players).filter(p => (p as Player).teamId === tId.toString());
            return (
              <div key={tId} className={`p-6 border-4 shadow-xl ${teamPlayers.length > 0 ? 'bg-slate-900 border-amber-600' : 'bg-black border-amber-900/10 opacity-30'}`}>
                <h3 className="text-xl font-black italic mb-4 border-b border-amber-900 pb-2 text-amber-700">{tId} 모둠</h3>
                {teamPlayers.map(p_raw => {
                  const p = p_raw as Player;
                  return (
                    <div key={p.id} className="flex justify-between bg-black/60 p-3 mb-2 border-l-4 border-amber-800">
                      <span className="font-bold text-amber-100">{p.name}</span>
                      <span className={`px-2 py-0.5 text-[10px] font-black text-white ${p.role === Role.COMBAT ? 'bg-red-950' : p.role === Role.QUIZ ? 'bg-blue-950' : 'bg-emerald-950'}`}>{p.role}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (view === 'lobby') {
    const players = Object.values(gameState.players);
    return (
      <div className="h-screen bg-[#0a0a0a] text-amber-100 p-8 flex flex-col items-center bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
        <h2 className="text-6xl font-black italic mb-10 text-amber-600">모둠과 역할 선택</h2>
        {myPlayer ? (
          <div className="bg-slate-900 p-16 border-double border-[16px] border-amber-900 text-center animate-in zoom-in shadow-2xl">
            <p className="text-5xl font-black mb-6 text-amber-200">선택 완료!</p>
            <p className="text-amber-700 font-black mb-10 tracking-widest animate-pulse">대기 중...</p>
            <div className="text-left bg-black/50 p-8 border-4 border-amber-950 mb-10 space-y-2">
              <p className="font-black text-xl text-amber-100">{myPlayer.teamId}번 모둠</p>
              <p className="font-bold text-amber-600 uppercase">내 역할: {myPlayer.role}</p>
              {myPlayer.role === Role.COMBAT && <p className="font-bold text-amber-600 uppercase">직업: {myPlayer.classType}</p>}
            </div>
            <button onClick={() => { network.sendAction({ type: 'CANCEL_SELECTION', payload: { playerId: myPlayer.id, teamId: myPlayer.teamId } }); setMyPlayer(null); }} className="px-10 py-3 bg-red-900 border-4 border-red-600 font-black text-white hover:bg-red-800 active:scale-95">취소하기</button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6 max-w-[1200px] w-full overflow-y-auto custom-scrollbar pr-4 pb-40">
            {[1,2,3,4,5,6,7,8,9].map(tId => {
              const teamP = players.filter(p => (p as Player).teamId === tId.toString()) as Player[];
              const qT = teamP.some(p => p.role === Role.QUIZ);
              const cT = teamP.some(p => p.role === Role.COMBAT);
              const sC = teamP.filter(p => p.role === Role.SUPPORT).length;
              return (
                <div key={tId} className="bg-slate-900 p-6 border-4 border-amber-900/60 shadow-xl group hover:border-amber-500 transition-all">
                  <h3 className="text-3xl font-black mb-6 italic border-b-2 border-amber-900/40 pb-2 text-amber-100">{tId}번 모둠</h3>
                  <div className="space-y-3">
                    <button disabled={qT} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.QUIZ })} className={`w-full p-3 font-black text-sm flex justify-between border-2 transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.QUIZ ? 'bg-amber-800 border-amber-200' : 'bg-black border-amber-900/30 disabled:opacity-20'}`}>🧠 퀴즈 담당 {qT && '✔'}</button>
                    <button disabled={sC >= 2} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.SUPPORT })} className={`w-full p-3 font-black text-sm flex justify-between border-2 transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.SUPPORT ? 'bg-amber-800 border-amber-200' : 'bg-black border-amber-900/30 disabled:opacity-20'}`}>🛡️ 서포터 담당 ({sC}/2)</button>
                    <div className="pt-4 border-t border-amber-900/20 mt-2">
                       <p className="text-[9px] font-black text-amber-800 mb-2 uppercase">전투 클래스</p>
                       <div className="grid grid-cols-2 gap-2">
                          {[ClassType.WARRIOR, ClassType.MAGE, ClassType.ARCHER, ClassType.ROGUE].map(ct => (
                            <button key={ct} disabled={cT} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.COMBAT, classType: ct })} className={`p-2 text-[10px] font-black border-2 transition-all ${pendingSelection?.classType === ct && pendingSelection?.teamId === tId.toString() ? 'bg-amber-800 border-amber-200' : 'bg-black border-amber-950 disabled:opacity-10'}`}>{ct}</button>
                          ))}
                       </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!myPlayer && (
          <button disabled={!pendingSelection} onClick={() => {
            const p = { id: userName, name: userName, teamId: pendingSelection!.teamId, role: pendingSelection!.role, classType: pendingSelection!.classType || ClassType.WARRIOR, points: 0, hasSubmittedQuiz: false } as Player;
            setMyPlayer(p); network.sendAction({ type: 'CONFIRM_SELECTION', payload: { player: p } });
          }} className="fixed bottom-10 px-24 py-8 bg-amber-800 border-double border-[12px] border-amber-500 font-black text-4xl text-white shadow-2xl active:scale-95 transition-all">역할 확정</button>
        )}
      </div>
    );
  }

  if (view === 'game') {
    const isTeacher = isHost;
    const team = myPlayer ? gameState.teams[myPlayer.teamId] : null;
    const currentQuizIdx = gameState.currentQuizIndex;
    const currentQuiz = gameState.quizzes[currentQuizIdx] || { question: "퀴즈 대기 중...", options: ["-","-","-","-"], answer: 0 };
    
    // 이전 퀴즈 결과 송출용 (BATTLE 단계에서 하단에 표시)
    const lastQuiz = gameState.phase === 'BATTLE' ? gameState.quizzes[currentQuizIdx] : null;

    if (gameState.phase === 'GAME_OVER') {
      const winTeam = gameState.winnerTeamId ? gameState.teams[gameState.winnerTeamId] : null;
      return (
        <div className="fixed inset-0 bg-[#0a0a0a] flex flex-col items-center justify-center p-10 text-amber-100 z-[9999] bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
          <h1 className="text-9xl font-black mb-10 text-amber-500 animate-bounce">최종 승리</h1>
          {winTeam ? (
            <div className="text-center space-y-6 bg-slate-900 p-20 border-double border-[16px] border-amber-600 shadow-2xl relative">
              <p className="text-6xl font-black text-amber-200 tracking-tighter mb-4">{winTeam.name}</p>
              <p className="text-4xl font-bold text-amber-700 tracking-[0.5em] uppercase border-y-2 border-amber-900 py-6">가장 위대한 모둠</p>
            </div>
          ) : <p className="text-4xl text-amber-800">승자가 없습니다.</p>}
          <button onClick={() => window.location.reload()} className="mt-16 px-16 py-6 bg-amber-800 border-4 border-amber-500 text-white font-black text-3xl shadow-lg hover:bg-amber-700 active:scale-95 transition-all">새 게임 시작</button>
        </div>
      );
    }

    return (
      <div className={`fixed inset-0 flex flex-col md:flex-row bg-[#020617] overflow-hidden`}>
        <div className={`flex-1 relative ${gameState.phase === 'QUIZ' ? 'opacity-40 grayscale saturate-0' : ''} transition-all duration-[1000ms]`}>
          <div className="absolute top-4 left-4 z-50 bg-black/60 px-4 py-2 border border-amber-900/50 rounded text-amber-200 font-black text-xs">
            진행도: {gameState.currentQuizIndex + 1} / {gameState.quizzes.length} 라운드
          </div>
          <GameCanvas teams={gameState.teams} myTeamId={myPlayer?.teamId} />
          <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-black/90 px-10 py-6 border-double border-[10px] border-amber-900 text-center shadow-2xl z-20">
            <p className="text-[10px] font-black uppercase text-amber-600 tracking-widest mb-1">{gameState.phase === 'QUIZ' ? '퀴즈 시간' : '전투 시간'}</p>
            <p className="text-5xl font-mono font-black text-amber-100">{gameState.timer}s</p>
          </div>

          {lastQuiz && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4 pointer-events-none">
              <div className="bg-black/80 p-4 border-l-4 border-amber-600 shadow-2xl text-center">
                <p className="text-[10px] text-amber-500 font-bold mb-1 uppercase tracking-tighter">직전 문제 학습</p>
                <p className="text-sm font-bold text-white mb-2 italic">" {lastQuiz.question} "</p>
                <p className="text-xs font-black text-amber-400">정답: {lastQuiz.options[lastQuiz.answer]}</p>
              </div>
            </div>
          )}

          {myPlayer?.role === Role.COMBAT && gameState.phase === 'BATTLE' && team && !team.isDead && (
            <>
              <div className="absolute bottom-12 left-12 scale-[1.5] z-30 opacity-80"><Joystick onMove={(dir) => network.sendAction({ type: 'MOVE', payload: { teamId: myPlayer.teamId, dir } })} /></div>
              <div className="absolute bottom-12 right-12 flex items-end gap-6 z-30">
                <div className="flex flex-col gap-4">
                  {team.unlockedSkills.map(skId => {
                    const sk = SKILLS_INFO[team.classType].find(s => s.id === skId);
                    const cd = Math.max(0, Math.ceil(((team.skillCooldowns[skId] || 0) - Date.now()) / 1000));
                    return (
                      <button key={skId} disabled={cd > 0 || team.mp < (sk?.mp || 0)} onClick={() => network.sendAction({ type: 'SKILL_USE', payload: { teamId: myPlayer.teamId, skId } })} className={`px-8 py-4 rounded-none font-black text-sm border-2 transition-all shadow-2xl ${cd > 0 ? 'bg-slate-800 border-slate-700 opacity-40' : 'bg-amber-900 border-amber-400 text-amber-100 hover:bg-amber-700 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]'}`}>
                        {sk?.name} {cd > 0 ? `(${cd}s)` : `(${sk?.mp}MP)`}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => network.sendAction({ type: 'ATTACK', payload: { teamId: myPlayer.teamId } })} className="w-44 h-44 bg-red-950 text-white rounded-full font-black text-6xl shadow-2xl border-8 border-amber-900 active:scale-90 transition-all flex items-center justify-center">⚔️</button>
              </div>
            </>
          )}
        </div>

        <div className={`w-full md:w-[450px] border-l-[10px] border-amber-950 p-6 overflow-y-auto custom-scrollbar bg-slate-900 text-amber-100 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] shadow-inner z-40`}>
          {isTeacher ? (
            <div className="space-y-6">
              <h3 className="text-4xl font-black italic text-amber-600 border-b-4 border-amber-900 pb-4 uppercase">교사용 대시보드</h3>
              <div className="bg-black/80 p-8 border-double border-[8px] border-amber-900 space-y-4">
                <p className="text-xs font-black text-amber-800 uppercase tracking-widest">현재 퀴즈</p>
                <p className="text-2xl font-black leading-tight text-amber-100 italic">" {currentQuiz.question} "</p>
                <button onClick={() => setShowAnswer(!showAnswer)} className="w-full py-4 bg-amber-900/30 border-2 border-amber-900 font-black text-xs uppercase tracking-widest hover:bg-amber-900/50">정답 {showAnswer ? '가리기' : '확인하기'}</button>
                {showAnswer && <div className="text-center font-black text-amber-400 text-3xl border-t border-amber-900/50 pt-4">A: {currentQuiz.options[currentQuiz.answer]}</div>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => handleHostAction({type:'ADJUST_TIMER', payload:{amount:10}})} className="bg-amber-800/40 border-4 border-amber-600 py-4 font-black">+10초</button>
                <button onClick={() => handleHostAction({type:'ADJUST_TIMER', payload:{amount:-10}})} className="bg-red-950/40 border-4 border-red-900 py-4 font-black">-10초</button>
              </div>
              <button onClick={() => handleHostAction({type:'SKIP_PHASE', payload:{}})} className="w-full bg-amber-800 border-4 border-amber-400 py-6 font-black text-2xl shadow-2xl hover:bg-amber-700">다음 단계로 넘기기</button>
            </div>
          ) : myPlayer?.role === Role.QUIZ ? (
            <div className="space-y-8">
              <h3 className="text-4xl font-black italic text-amber-600 uppercase">현자(퀴즈 담당)</h3>
              {gameState.phase === 'QUIZ' ? (
                gameState.players[myPlayer.id].hasSubmittedQuiz ? (
                  <div className="text-center py-20 bg-black/60 border-double border-[10px] border-amber-900 animate-in zoom-in">
                    <p className="text-8xl mb-6">📜</p>
                    <p className="font-black text-2xl text-amber-200">정답을 제출했습니다.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-8 bg-black border-4 border-amber-600 font-black text-xl mb-4 italic leading-relaxed text-amber-100">" {currentQuiz.question} "</div>
                    {currentQuiz.options.map((opt, i) => (
                      <button key={i} onClick={() => network.sendAction({ type: 'QUIZ_ANSWER', payload: { playerId: myPlayer.id, teamId: myPlayer.teamId, correct: i === currentQuiz.answer } })} className="w-full p-6 bg-amber-950/80 border-2 border-amber-800 text-left font-black text-xl hover:bg-amber-800 active:scale-95 transition-all flex items-center group">
                        <span className="bg-amber-400 text-black px-4 py-1 mr-6 font-mono font-black group-hover:scale-110 transition-transform">{i+1}</span> 
                        <span className="text-amber-100">{opt}</span>
                      </button>
                    ))}
                  </div>
                )
              ) : <div className="p-20 text-center opacity-40 font-black italic border-4 border-amber-950 bg-black/50">전투가 진행 중입니다...<br/><br/>다음 퀴즈를 준비하세요.</div>}
            </div>
          ) : myPlayer?.role === Role.SUPPORT && team ? (
            <div className="space-y-8 pb-32">
              <div className="flex justify-between items-center bg-black p-6 border-double border-8 border-amber-900 sticky top-0 z-10 shadow-2xl">
                <h3 className="text-2xl font-black italic text-amber-600 uppercase">조력자(서포터)</h3>
                <span className="bg-amber-400 text-black px-6 py-1 font-black text-2xl">{team.points} P</span>
              </div>
              {gameState.phase === 'QUIZ' ? (
                <div className="p-20 text-center bg-black/40 border-4 border-amber-950 opacity-60 font-black italic">퀴즈 시간입니다.<br/><br/>전투가 시작되면<br/>조작 가능합니다.</div>
              ) : (
                <div className="space-y-8">
                  <section>
                    <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-4 border-b border-amber-900/40 pb-1">장비 강화 (4P)</p>
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'weapon', cost:4}})} className={`p-4 flex flex-col items-center gap-2 border-2 transition-all ${team.items.weapon ? 'bg-amber-800 border-amber-300' : 'bg-black border-amber-950 opacity-40'}`} disabled={team.items.weapon}><span className="text-4xl">⚔️</span><span className="text-[10px] font-black">무기</span></button>
                      <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'armor', cost:4}})} className={`p-4 flex flex-col items-center gap-2 border-2 transition-all ${team.items.armor ? 'bg-amber-800 border-amber-300' : 'bg-black border-amber-950 opacity-40'}`} disabled={team.items.armor}><span className="text-4xl">🛡️</span><span className="text-[10px] font-black">갑옷</span></button>
                      <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'boots', cost:4}})} className={`p-4 flex flex-col items-center gap-2 border-2 transition-all ${team.items.boots ? 'bg-amber-800 border-amber-300' : 'bg-black border-amber-950 opacity-40'}`} disabled={team.items.boots}><span className="text-4xl">👟</span><span className="text-[10px] font-black">신발</span></button>
                    </div>
                  </section>
                  <section>
                    <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-4 border-b border-amber-900/40 pb-1">기술 습득 (6P)</p>
                    <div className="space-y-2">
                      {SKILLS_INFO[team.classType].map(sk => (
                        <button key={sk.id} disabled={team.unlockedSkills.includes(sk.id)} onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'SKILL', skillId:sk.id, cost:6}})} className="w-full p-4 bg-black border-2 border-amber-900 text-left disabled:opacity-20 group active:scale-95 transition-all">
                          <div className="flex justify-between font-black text-sm mb-1"><span className="text-amber-200">{sk.name}</span><span className="text-amber-600 font-mono">6P</span></div>
                          <p className="text-[10px] text-amber-800 italic leading-tight font-bold group-hover:text-amber-500">{sk.desc}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                  <section>
                    <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-4 border-b border-amber-900/40 pb-1">물약 및 축복</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'hp', cost:3}})} className="p-3 bg-red-950/30 border-2 border-red-900 text-[12px] font-black">체력 회복 (3P)</button>
                      <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'mp', cost:3}})} className="p-3 bg-blue-950/30 border-2 border-blue-900 text-[12px] font-black">마력 회복 (3P)</button>
                      <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'atk', cost:5}})} className="p-3 bg-amber-950/20 border-2 border-amber-900 text-[12px] font-black">공격력 강화 (5P)</button>
                      <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'def', cost:5}})} className="p-3 bg-amber-950/20 border-2 border-amber-900 text-[12px] font-black">방어력 강화 (5P)</button>
                    </div>
                    <button disabled={!team.isDead} onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'revive', cost:8}})} className={`w-full mt-6 py-6 border-double border-8 font-black text-2xl transition-all ${team.isDead ? 'bg-amber-700 border-amber-200 text-white shadow-2xl animate-bounce' : 'bg-black border-amber-950 opacity-20'}`}>⚡ 부활 시키기 (8P)</button>
                  </section>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col justify-center items-center gap-10">
              <div className="text-[16rem] drop-shadow-[0_0_80px_rgba(255,255,255,0.1)] grayscale-0 animate-pulse">
                {team?.classType === ClassType.WARRIOR ? '🗡️' : team?.classType === ClassType.MAGE ? '🔮' : team?.classType === ClassType.ARCHER ? '🏹' : '👤'}
              </div>
              <p className="text-6xl font-black text-amber-600 uppercase italic tracking-widest border-y-4 border-amber-900 py-4 w-full text-center">{team?.classType}</p>
              <div className="grid grid-cols-2 gap-8 w-full bg-black/80 p-8 border-double border-8 border-amber-950 font-black text-center shadow-2xl">
                <div>
                    <p className="text-xs text-amber-800 uppercase mb-2">공격력</p>
                    <p className="text-4xl text-amber-200">{team?.stats.atk}</p>
                </div>
                <div>
                    <p className="text-xs text-amber-800 uppercase mb-2">방어력</p>
                    <p className="text-4xl text-amber-200">{team?.stats.def}</p>
                </div>
                <div className="col-span-2 pt-4 border-t border-amber-900/40">
                    <p className="text-[10px] text-amber-800 uppercase mb-2">체력 / 마력</p>
                    <div className="flex flex-col gap-2">
                        <div className="h-4 bg-red-950 w-full rounded-full overflow-hidden border border-red-900">
                            <div className="h-full bg-red-600 transition-all duration-300" style={{ width: `${(team?.hp || 0) / (team?.maxHp || 1) * 100}%` }} />
                        </div>
                        <div className="h-4 bg-blue-950 w-full rounded-full overflow-hidden border border-blue-900">
                            <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${(team?.mp || 0) / (team?.maxMp || 1) * 100}%` }} />
                        </div>
                    </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
};
export default App;
