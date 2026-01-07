
import React, { useState, useEffect, useRef } from 'react';
import { network } from './services/p2pNetwork';
import { Role, ClassType, Player, Team, GameState, Quiz } from './types';
import { CLASS_BASE_STATS, COSTS, SKILLS_INFO } from './constants';
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
    if (isHost) {
      network.setActionListener((action: any) => handleHostAction(action));
    }
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
          
          // 버프 및 효과 시간 만료 처리 (필터링)
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
        case 'CANCEL_SELECTION': {
          delete newState.players[payload.playerId];
          if (!Object.values(newState.players).some(p => (p as Player).teamId === payload.teamId)) delete newState.teams[payload.teamId];
          break;
        }
        case 'MOVE': {
          const t = newState.teams[payload.teamId];
          if (t && !t.isDead && newState.phase === 'BATTLE') {
            const speedMult = t.activeEffects.some(e => e.type === 'w_speed') ? 2 : 1;
            t.x = Math.max(0, Math.min(1000, t.x + payload.dir.x * t.stats.speed * 3 * speedMult));
            t.y = Math.max(0, Math.min(1000, t.y + payload.dir.y * t.stats.speed * 3 * speedMult));
            if (payload.dir.x !== 0 || payload.dir.y !== 0) t.angle = Math.atan2(payload.dir.y, payload.dir.x) * (180 / Math.PI);
          }
          break;
        }
        case 'ATTACK': {
          const t = newState.teams[payload.teamId];
          if (t && !t.isDead && newState.phase === 'BATTLE') {
            t.lastAtkTime = now;
            playSound('attack');
            const rangeMult = t.activeEffects.some(e => e.type === 'a_range') ? 3 : 1;
            const atkMult = t.activeEffects.some(e => e.type === 'w_double') ? 2 : 1;
            const attackerAngleRad = t.angle * (Math.PI / 180);
            
            Object.values(newState.teams).forEach((target: any) => {
              if (target.id === t.id || target.isDead) return;
              const dx = target.x - t.x; const dy = target.y - t.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const angleToTarget = Math.atan2(dy, dx);
              const angleDiff = Math.abs(angleToTarget - attackerAngleRad);
              const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));

              // 클래스별 방향성 판정
              let isHit = false;
              if (t.classType === ClassType.WARRIOR || t.classType === ClassType.ROGUE) {
                // 부채꼴 90도 판정
                if (dist < t.stats.range * rangeMult && Math.abs(normalizedDiff) < Math.PI / 4) isHit = true;
              } else {
                // 직선형 좁은 판정
                if (dist < t.stats.range * rangeMult && Math.abs(normalizedDiff) < 0.2) isHit = true;
              }

              if (isHit) {
                if (target.activeEffects.some((e: any) => e.type === 'w_invinc')) return;
                const damage = Math.max(5, (t.stats.atk * atkMult) - target.stats.def);
                target.hp = Math.max(0, target.hp - damage);
                t.totalDamageDealt = (t.totalDamageDealt || 0) + damage;
                if (target.hp <= 0) target.isDead = true;
                t.points += 2;
              }
            });
          }
          break;
        }
        case 'SUPPORT_ACTION': {
          const t = newState.teams[payload.teamId];
          if (!t || t.points < payload.cost) return newState;
          t.points -= payload.cost;
          playSound('click');
          if (payload.action === 'ITEM') {
            (t.items as any)[payload.item] = true;
            if (payload.item === 'weapon') t.stats.atk += 10;
            if (payload.item === 'armor') t.stats.def += 10;
            if (payload.item === 'boots') t.stats.speed += 1.2;
          } else if (payload.action === 'STAT') {
            if (payload.stat === 'hp') t.hp = Math.min(t.maxHp, t.hp + 40);
            if (payload.stat === 'mp') t.mp = Math.min(t.maxMp, t.mp + 40);
            if (payload.stat === 'revive') { t.isDead = false; t.hp = 50; }
            if (payload.stat === 'atk') t.stats.atk += 5;
            if (payload.stat === 'def') t.stats.def += 5;
          } else if (payload.action === 'SKILL') {
            if (!t.unlockedSkills.includes(payload.skillId)) t.unlockedSkills.push(payload.skillId);
          }
          break;
        }
        case 'SKILL_USE': {
          const t = newState.teams[payload.teamId];
          const skill = SKILLS_INFO[t.classType].find(s => s.id === payload.skId);
          if (!t || !skill || t.isDead || t.mp < skill.mp) return newState;
          if (now < (t.skillCooldowns[payload.skId] || 0)) return newState;

          t.mp -= skill.mp;
          t.skillCooldowns[payload.skId] = now + 5000;
          playSound('skill');

          if (['w_speed', 'w_invinc', 'w_double', 'r_hide', 'a_range'].includes(skill.id)) {
            t.activeEffects.push({ type: skill.id, until: now + 2000 });
          } else {
            t.activeEffects.push({ type: skill.id, until: now + 500 });
            // 즉시 발동 공격 스킬 로직 (광역/레이저 등)
            if (skill.id === 'm_thunder') {
              Object.values(newState.teams).forEach((target: any) => {
                if (target.id === t.id || target.isDead) return;
                const dist = Math.sqrt((target.x - t.x)**2 + (target.y - t.y)**2);
                if (dist < 400) { target.hp = Math.max(0, target.hp - (t.stats.atk * 2.5)); if(target.hp===0) target.isDead=true; }
              });
            }
          }
          break;
        }
        case 'QUIZ_ANSWER': {
          const p = newState.players[payload.playerId];
          if (p && !p.hasSubmittedQuiz) {
            p.hasSubmittedQuiz = true;
            if (payload.correct) { newState.teams[payload.teamId].points += 10; playSound('quiz_ok'); }
            else { newState.teams[payload.teamId].points += 5; playSound('quiz_no'); }
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
    const finalCode = (customCode || roomCode).toUpperCase();
    if (!finalCode) return alert("코드를 입력하세요.");
    setIsConnecting(true);
    network.init(finalCode, true, setGameState, () => {
      setIsHost(true); setIsConnecting(false); setRoomCode(finalCode);
      const initial = { isStarted: false, players: {}, teams: {}, quizzes: quizList, currentQuizIndex: 0, phase: 'QUIZ', timer: 30, roomCode: finalCode } as GameState;
      setGameState(initial); network.broadcastState(initial); setView('host_lobby');
    });
  };

  if (view === 'landing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#020617] text-white">
        <h1 className="text-8xl font-black italic text-blue-500 mb-4 animate-pulse">EDU ARENA</h1>
        <div className="w-full max-w-md p-10 bg-slate-900 rounded-[3rem] border-2 border-blue-500/30 space-y-6 shadow-2xl">
          <input className="w-full p-5 bg-slate-800 rounded-2xl font-bold" placeholder="영웅 닉네임" value={userName} onChange={e => setUserName(e.target.value)} />
          <input className="w-full p-5 bg-slate-800 rounded-2xl font-black uppercase" placeholder="방 코드" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
          <button onClick={() => { if(!userName) return alert("닉네임 필요"); setIsConnecting(true); network.init(roomCode.toUpperCase(), false, setGameState, () => { setIsConnecting(false); setView('lobby'); }); }} className="w-full py-5 bg-blue-600 rounded-2xl font-black text-2xl">입장하기</button>
          <button onClick={() => setView('host_setup')} className="w-full py-2 text-slate-500 font-bold hover:text-white transition-colors text-sm">교사용 전장 설계 (Host)</button>
        </div>
      </div>
    );
  }

  if (view === 'host_setup') {
    return (
      <div className="flex flex-col h-screen bg-[#020617] text-white p-10">
        <h2 className="text-4xl font-black text-blue-400 mb-10">전장 설계자 메뉴</h2>
        <div className="grid grid-cols-2 gap-10">
          <div className="bg-slate-900 p-8 rounded-3xl space-y-4">
            <h3 className="text-xl font-bold">1. 퀴즈 입력</h3>
            <input className="w-full p-4 bg-black rounded-xl" placeholder="질문" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} />
            <div className="grid grid-cols-2 gap-2">
              {newQuiz.options.map((o, i) => <input key={i} className="p-3 bg-black rounded-lg text-xs" placeholder={`보기 ${i+1}`} value={o} onChange={e => { const opts = [...newQuiz.options]; opts[i] = e.target.value; setNewQuiz({...newQuiz, options: opts}); }} />)}
            </div>
            <button onClick={() => { if(newQuiz.question) { setQuizList([...quizList, newQuiz]); setNewQuiz({question:'', options:['','','',''], answer:0}); } }} className="w-full py-3 bg-blue-600 rounded-xl font-bold">퀴즈 추가</button>
          </div>
          <div className="bg-slate-950 p-8 rounded-3xl overflow-y-auto custom-scrollbar h-[400px]">
            <h3 className="text-xl font-bold mb-4">등록된 퀴즈 ({quizList.length})</h3>
            {quizList.map((q, i) => <div key={i} className="p-4 bg-white/5 rounded-xl mb-2 flex justify-between"><span>{i+1}. {q.question}</span><button onClick={() => setQuizList(quizList.filter((_, idx) => idx !== i))} className="text-red-500">삭제</button></div>)}
          </div>
        </div>
        <div className="mt-auto flex gap-4">
          <input className="flex-1 p-5 bg-slate-900 rounded-2xl text-2xl font-black uppercase text-center" placeholder="방 코드 설정" value={customCode} onChange={e => setCustomCode(e.target.value)} />
          <button onClick={createRoom} className="px-20 bg-blue-600 rounded-2xl font-black text-2xl">전장 생성</button>
        </div>
      </div>
    );
  }

  if (view === 'host_lobby') {
    return (
      <div className="h-screen bg-[#020617] text-white flex flex-col p-10">
        <div className="flex justify-between items-center mb-10 bg-slate-900 p-8 rounded-3xl border border-white/10">
          <div><p className="text-blue-500 text-xs font-black uppercase mb-1">Room Code</p><h2 className="text-8xl font-mono font-black">{gameState.roomCode}</h2></div>
          <button onClick={() => { playSound('phase'); const ns = { ...gameState, isStarted: true }; setGameState(ns); network.broadcastState(ns); setView('game'); }} className="px-16 py-8 bg-emerald-600 rounded-3xl font-black text-4xl hover:scale-105 transition-all">전투 개시</button>
        </div>
        <div className="grid grid-cols-3 gap-8 overflow-y-auto flex-1 custom-scrollbar">
          {[1,2,3,4,5,6,7,8,9].map(tId => {
            /* Fix: Cast p to Player to access teamId property */
            const teamPlayers = Object.values(gameState.players).filter(p => (p as Player).teamId === tId.toString());
            return (
              <div key={tId} className={`p-6 rounded-3xl border transition-all ${teamPlayers.length > 0 ? 'bg-slate-900 border-blue-500' : 'bg-slate-950 border-white/5 opacity-40'}`}>
                <h3 className="text-2xl font-black italic mb-4">{tId} 모둠</h3>
                {teamPlayers.map(p_raw => {
                  /* Fix: Cast individual player to Player interface */
                  const p = p_raw as Player;
                  return (
                    <div key={p.id} className="flex justify-between bg-black/40 p-3 rounded-xl mb-2 text-sm">
                      <span className="font-bold">{p.name}</span>
                      <span className={`px-2 rounded text-[10px] font-black ${p.role === Role.COMBAT ? 'bg-red-600' : p.role === Role.QUIZ ? 'bg-blue-600' : 'bg-emerald-600'}`}>{p.role}</span>
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
      <div className="h-screen bg-[#020617] text-white p-8 flex flex-col items-center">
        <h2 className="text-5xl font-black italic mb-10">모둠 및 역할 선택</h2>
        {myPlayer ? (
          <div className="bg-slate-900 p-12 rounded-[3rem] border-4 border-blue-500 text-center animate-in fade-in zoom-in">
            <p className="text-3xl font-black mb-4">참가 확정!</p>
            <p className="text-blue-400 font-bold mb-8">선생님의 신호를 기다리고 있습니다...</p>
            <div className="text-left bg-black/30 p-6 rounded-2xl mb-8 font-bold">
              <p>모둠: {myPlayer.teamId}팀</p>
              <p>역할: {myPlayer.role}</p>
              {myPlayer.role === Role.COMBAT && <p>직업: {myPlayer.classType}</p>}
            </div>
            <button onClick={() => { network.sendAction({ type: 'CANCEL_SELECTION', payload: { playerId: myPlayer.id, teamId: myPlayer.teamId } }); setMyPlayer(null); }} className="px-8 py-3 bg-red-600 rounded-xl font-bold">선택 취소</button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6 max-w-6xl w-full overflow-y-auto custom-scrollbar pr-4">
            {[1,2,3,4,5,6,7,8,9].map(tId => {
              /* Fix: Cast players in map to Player for type safety */
              const teamP = players.filter(p => (p as Player).teamId === tId.toString()) as Player[];
              const qT = teamP.some(p => p.role === Role.QUIZ);
              const cT = teamP.some(p => p.role === Role.COMBAT);
              const sC = teamP.filter(p => p.role === Role.SUPPORT).length;
              return (
                <div key={tId} className="bg-slate-900 p-6 rounded-3xl border border-white/10">
                  <h3 className="text-2xl font-black mb-4 italic">{tId} Team</h3>
                  <div className="space-y-2">
                    <button disabled={qT} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.QUIZ })} className={`w-full p-3 rounded-xl text-left font-black text-sm flex justify-between ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.QUIZ ? 'bg-blue-600 ring-2 ring-white' : 'bg-slate-800'}`}>🧠 문제풀이 {qT && '✔'}</button>
                    <button disabled={sC >= 2} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.SUPPORT })} className={`w-full p-3 rounded-xl text-left font-black text-sm flex justify-between ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.SUPPORT ? 'bg-emerald-600 ring-2 ring-white' : 'bg-slate-800'}`}>🛡️ 서포터 ({sC}/2)</button>
                    <div className="grid grid-cols-2 gap-1 mt-2 pt-2 border-t border-white/5">
                      {[ClassType.WARRIOR, ClassType.MAGE, ClassType.ARCHER, ClassType.ROGUE].map(ct => (
                        <button key={ct} disabled={cT} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.COMBAT, classType: ct })} className={`p-2 rounded-lg text-[10px] font-black ${pendingSelection?.classType === ct && pendingSelection?.teamId === tId.toString() ? 'bg-red-600 ring-2 ring-white' : 'bg-black'}`}>{ct}</button>
                      ))}
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
          }} className="fixed bottom-10 px-20 py-6 bg-blue-600 rounded-3xl font-black text-3xl shadow-2xl disabled:opacity-50 transition-all">전장 참여</button>
        )}
      </div>
    );
  }

  if (view === 'game') {
    const isTeacher = isHost;
    const team = myPlayer ? gameState.teams[myPlayer.teamId] : null;
    const currentQuiz = gameState.quizzes[gameState.currentQuizIndex] || { question: "대기 중...", options: ["-","-","-","-"], answer: 0 };
    
    if (gameState.phase === 'GAME_OVER') {
      const winTeam = gameState.winnerTeamId ? gameState.teams[gameState.winnerTeamId] : null;
      return (
        <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-10 text-white z-[9999]">
          <h1 className="text-9xl font-black italic mb-10 text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-600">VICTORY</h1>
          {winTeam ? (
            <div className="text-center space-y-4 bg-slate-900 p-16 rounded-[4rem] border-8 border-amber-500 shadow-2xl">
              <p className="text-5xl font-black">{winTeam.name}</p>
              <p className="text-2xl font-bold text-amber-500 uppercase">{winTeam.classType} CLASS</p>
              <div className="flex gap-10 justify-center mt-10">
                <div className="text-center"><p className="text-xs text-slate-500">SCORE</p><p className="text-4xl font-black">{winTeam.points}</p></div>
                <div className="text-center"><p className="text-xs text-slate-500">DAMAGE</p><p className="text-4xl font-black">{winTeam.totalDamageDealt?.toFixed(0)}</p></div>
              </div>
            </div>
          ) : <p className="text-4xl">승자가 없습니다.</p>}
          <button onClick={() => window.location.reload()} className="mt-20 px-12 py-5 bg-white text-black font-black rounded-full text-2xl">다시 도전하기</button>
        </div>
      );
    }

    return (
      <div className={`fixed inset-0 flex flex-col md:flex-row bg-[#020617] overflow-hidden`}>
        <div className={`flex-1 relative ${gameState.phase === 'QUIZ' ? 'opacity-50' : ''}`}>
          <GameCanvas teams={gameState.teams} myTeamId={myPlayer?.teamId} />
          <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-black/80 px-10 py-4 rounded-3xl border-4 border-white/20 text-center backdrop-blur-md">
            <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">{gameState.phase} PHASE</p>
            <p className="text-5xl font-mono font-black">{gameState.timer}s</p>
          </div>
          {myPlayer?.role === Role.COMBAT && gameState.phase === 'BATTLE' && team && !team.isDead && (
            <>
              <div className="absolute bottom-12 left-12 scale-150"><Joystick onMove={(dir) => network.sendAction({ type: 'MOVE', payload: { teamId: myPlayer.teamId, dir } })} /></div>
              <div className="absolute bottom-12 right-12 flex items-end gap-6">
                <div className="flex flex-col gap-4">
                  {team.unlockedSkills.map(skId => {
                    const sk = SKILLS_INFO[team.classType].find(s => s.id === skId);
                    const cd = Math.max(0, Math.ceil(((team.skillCooldowns[skId] || 0) - Date.now()) / 1000));
                    return (
                      <button key={skId} disabled={cd > 0 || team.mp < (sk?.mp || 0)} onClick={() => network.sendAction({ type: 'SKILL_USE', payload: { teamId: myPlayer.teamId, skId } })} className={`px-6 py-4 rounded-2xl font-black text-sm border-4 transition-all ${cd > 0 ? 'bg-slate-800 border-slate-600 opacity-50' : 'bg-blue-600 border-white/20 active:scale-90 shadow-xl'}`}>
                        {sk?.name} {cd > 0 ? `(${cd}s)` : `(${sk?.mp}M)`}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => network.sendAction({ type: 'ATTACK', payload: { teamId: myPlayer.teamId } })} className="w-44 h-44 bg-red-600 rounded-full font-black text-6xl shadow-2xl border-8 border-white/30 active:scale-95 transition-all">⚔️</button>
              </div>
            </>
          )}
        </div>

        <div className={`w-full md:w-[400px] border-l-4 border-white/10 p-6 overflow-y-auto custom-scrollbar bg-slate-900/50 backdrop-blur-xl`}>
          {isTeacher ? (
            <div className="space-y-6">
              <h3 className="text-3xl font-black italic text-blue-500 border-b border-white/10 pb-4 uppercase">Host Console</h3>
              <div className="bg-black/50 p-6 rounded-3xl border border-white/10 space-y-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Quiz Status</p>
                <p className="text-xl font-black leading-tight">Q: {currentQuiz.question}</p>
                <button onClick={() => setShowAnswer(!showAnswer)} className="w-full py-3 bg-white/5 rounded-xl font-bold text-sm">정답 {showAnswer ? '숨기기' : '보기'}</button>
                {showAnswer && <p className="text-center font-black text-emerald-400 text-lg">A: {currentQuiz.options[currentQuiz.answer]}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => handleHostAction({type:'ADJUST_TIMER', payload:{amount:5}})} className="bg-emerald-600 py-4 rounded-2xl font-black">+5s</button>
                <button onClick={() => handleHostAction({type:'ADJUST_TIMER', payload:{amount:-5}})} className="bg-rose-600 py-4 rounded-2xl font-black">-5s</button>
              </div>
              <button onClick={() => handleHostAction({type:'SKIP_PHASE', payload:{}})} className="w-full bg-blue-600 py-5 rounded-2xl font-black text-xl shadow-xl">페이즈 즉시 스킵</button>
            </div>
          ) : myPlayer?.role === Role.QUIZ ? (
            <div className="space-y-8">
              <h3 className="text-3xl font-black italic text-violet-400">BRAIN</h3>
              {gameState.phase === 'QUIZ' ? (
                gameState.players[myPlayer.id].hasSubmittedQuiz ? (
                  <div className="text-center py-20 bg-black/30 rounded-3xl border-2 border-white/10 animate-pulse"><p className="text-6xl mb-4">✅</p><p className="font-black text-xl">정답 제출 완료!</p></div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-6 bg-slate-950 rounded-3xl border-2 border-violet-500 font-bold text-lg mb-4">{currentQuiz.question}</div>
                    {currentQuiz.options.map((opt, i) => (
                      <button key={i} onClick={() => network.sendAction({ type: 'QUIZ_ANSWER', payload: { playerId: myPlayer.id, teamId: myPlayer.teamId, correct: i === currentQuiz.answer } })} className="w-full p-5 bg-violet-600 rounded-2xl text-left font-black text-sm hover:bg-violet-500 transition-all active:scale-95 shadow-lg">
                        <span className="bg-white/20 px-3 py-1 rounded-lg mr-4 font-mono">{i+1}</span> {opt}
                      </button>
                    ))}
                  </div>
                )
              ) : <div className="p-20 text-center opacity-30 font-black italic">BATTLE PHASE<br/>지략가의 시간입니다.</div>}
            </div>
          ) : myPlayer?.role === Role.SUPPORT && team ? (
            <div className="space-y-6 pb-20">
              <div className="flex justify-between items-center bg-black/40 p-5 rounded-3xl border-2 border-emerald-500/50 sticky top-0 z-10 backdrop-blur-md">
                <h3 className="text-2xl font-black italic text-emerald-400">SUPPORT</h3>
                <span className="bg-amber-500 text-black px-5 py-1 rounded-full font-black italic">{team.points} P</span>
              </div>
              <div className="space-y-6">
                <section>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Permanent Items (4P)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'weapon', cost:4}})} className={`p-4 rounded-2xl flex flex-col items-center gap-1 border transition-all ${team.items.weapon ? 'bg-amber-600 border-white text-white' : 'bg-slate-900 border-white/10 opacity-60'}`} disabled={team.items.weapon}><span>⚔️</span><span className="text-[10px] font-black">무기</span></button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'armor', cost:4}})} className={`p-4 rounded-2xl flex flex-col items-center gap-1 border transition-all ${team.items.armor ? 'bg-amber-600 border-white text-white' : 'bg-slate-900 border-white/10 opacity-60'}`} disabled={team.items.armor}><span>🛡️</span><span className="text-[10px] font-black">갑옷</span></button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'boots', cost:4}})} className={`p-4 rounded-2xl flex flex-col items-center gap-1 border transition-all ${team.items.boots ? 'bg-amber-600 border-white text-white' : 'bg-slate-900 border-white/10 opacity-60'}`} disabled={team.items.boots}><span>👟</span><span className="text-[10px] font-black">신발</span></button>
                  </div>
                </section>
                <section>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Unlock Skills (6P)</p>
                  <div className="space-y-2">
                    {SKILLS_INFO[team.classType].map(sk => (
                      <button key={sk.id} disabled={team.unlockedSkills.includes(sk.id)} onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'SKILL', skillId:sk.id, cost:6}})} className="w-full p-4 bg-slate-900 border border-white/10 rounded-2xl text-left disabled:opacity-30 group transition-all">
                        <div className="flex justify-between font-black text-xs mb-1"><span>{sk.name}</span><span className="bg-white/10 px-2 rounded">6P</span></div>
                        <p className="text-[10px] text-slate-500 leading-tight">{sk.desc}</p>
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Team Buffs & Recovery</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'hp', cost:3}})} className="p-3 bg-rose-900/20 border border-rose-500/30 rounded-xl text-xs font-black">❤️ 체력 (3P)</button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'mp', cost:3}})} className="p-3 bg-blue-900/20 border border-blue-500/30 rounded-xl text-xs font-black">💧 마력 (3P)</button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'atk', cost:5}})} className="p-3 bg-slate-800 border border-white/10 rounded-xl text-xs font-black">⚔️ 공격 (5P)</button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'def', cost:5}})} className="p-3 bg-slate-800 border border-white/10 rounded-xl text-xs font-black">🛡️ 방어 (5P)</button>
                  </div>
                  <button disabled={!team.isDead} onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'revive', cost:8}})} className={`w-full mt-3 py-4 rounded-2xl font-black border-4 transition-all ${team.isDead ? 'bg-emerald-600 border-white shadow-xl animate-bounce' : 'bg-slate-950 border-white/5 opacity-20'}`}>✨ 팀원 부활 (8P)</button>
                </section>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col justify-center items-center gap-6">
              <div className="text-[12rem] animate-bounce">{team?.classType === ClassType.WARRIOR ? '🛡️' : team?.classType === ClassType.MAGE ? '🔮' : team?.classType === ClassType.ARCHER ? '🏹' : '🗡️'}</div>
              <p className="text-4xl font-black text-red-500 uppercase italic tracking-widest">{team?.classType}</p>
              <div className="grid grid-cols-2 gap-4 w-full bg-black/40 p-8 rounded-[3rem] border-2 border-white/5 font-black text-center">
                <div><p className="text-[10px] text-slate-500 uppercase">Attack</p><p className="text-2xl text-blue-400">{team?.stats.atk}</p></div>
                <div><p className="text-[10px] text-slate-500 uppercase">Defense</p><p className="text-2xl text-emerald-400">{team?.stats.def}</p></div>
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
