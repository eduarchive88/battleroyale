
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Team, ClassType } from '../types';

interface GameCanvasProps {
  teams: Record<string, Team>;
  myTeamId?: string;
}

const getImageUrl = (classType: ClassType) => {
  const ids = {
    [ClassType.WARRIOR]: '1U3Y065zOntBi-tTx4NAnJMJ1OWBIbgtd',
    [ClassType.ARCHER]: '15KQrOqbkCoZuoS2QQh5ADc4ugTqua0_5',
    [ClassType.MAGE]: '19YSw9IVjx8wF1qbviBaUHlBs73lT6GqB',
    [ClassType.ROGUE]: '1vEqW-gD0N_LF1h1A8vVkPpuIZ-D6cZvG'
  };
  return `https://lh3.googleusercontent.com/d/${ids[classType]}`;
};

export const GameCanvas: React.FC<GameCanvasProps> = ({ teams, myTeamId }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const lastAtkTimes = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    
    // 이펙트 레이어는 매 프레임 초기화하지 않고 애니메이션 후 자가 삭제되도록 관리
    let mainLayer = svg.select('.main-layer');
    if (mainLayer.empty()) {
      mainLayer = svg.append('g').attr('class', 'main-layer');
      mainLayer.append('g').attr('class', 'grid-layer').lower();
      mainLayer.append('g').attr('class', 'effect-layer');
      mainLayer.append('g').attr('class', 'unit-layer');
      
      const grid = mainLayer.select('.grid-layer');
      for (let i = 0; i <= 1000; i += 100) {
        grid.append('line').attr('x1', i).attr('y1', 0).attr('x2', i).attr('y2', 1000).attr('stroke', '#1e293b').attr('stroke-width', 1).attr('opacity', 0.2);
        grid.append('line').attr('x1', 0).attr('y1', i).attr('x2', 1000).attr('y2', i).attr('stroke', '#1e293b').attr('stroke-width', 1).attr('opacity', 0.2);
      }
    }

    const effectLayer = mainLayer.select('.effect-layer');
    const unitLayer = mainLayer.select('.unit-layer');
    const teamArray = Object.values(teams);
    
    const units = unitLayer.selectAll('.unit').data(teamArray, (d: any) => d.id).join(
      enter => {
        const g = enter.append('g').attr('class', 'unit');
        g.append('ellipse').attr('class', 'shadow').attr('rx', 35).attr('ry', 15).attr('cy', 35).attr('fill', 'black').attr('opacity', 0.3);
        g.append('image').attr('class', 'char-img').attr('x', -40).attr('y', -40).attr('width', 80).attr('height', 80).attr('preserveAspectRatio', 'xMidYMid meet');
        g.append('circle').attr('class', 'selection-ring').attr('r', 45).attr('fill', 'none').attr('stroke-width', 3).attr('stroke-dasharray', '5,5');
        const info = g.append('g').attr('class', 'info-ui').attr('transform', 'translate(0, -55)');
        info.append('text').attr('class', 'name').attr('text-anchor', 'middle').attr('fill', 'white').style('font-size', '14px').style('font-weight', '900').style('text-shadow', '0 2px 4px black');
        info.append('rect').attr('class', 'hp-bg').attr('x', -35).attr('y', 5).attr('width', 70).attr('height', 8).attr('fill', '#450a0a').attr('rx', 4);
        info.append('rect').attr('class', 'hp-fg').attr('x', -35).attr('y', 5).attr('height', 8).attr('fill', '#ef4444').attr('rx', 4);
        return g;
      }
    );

    units.attr('transform', d => `translate(${d.x}, ${d.y}) rotate(${d.angle})`)
      .style('opacity', d => {
        const isHidden = d.activeEffects.some(e => e.type === 'r_hide');
        if (isHidden && d.id !== myTeamId) return 0;
        return d.isDead ? 0.2 : 1;
      });

    units.select('.info-ui').attr('transform', d => `translate(0, -55) rotate(${-d.angle})`);
    units.select('.char-img').attr('xlink:href', d => getImageUrl(d.classType))
      .style('filter', d => {
        if (d.activeEffects.some(e => e.type === 'w_invinc')) return 'drop-shadow(0 0 15px gold) brightness(1.2)';
        if (d.activeEffects.some(e => e.type === 'w_double')) return 'drop-shadow(0 0 10px red) saturate(2)';
        return 'none';
      });

    units.select('.selection-ring').attr('stroke', d => d.id === myTeamId ? '#3b82f6' : 'none').attr('opacity', d => d.id === myTeamId ? 1 : 0);
    units.select('.name').text(d => `${d.name} (${d.points}P)`);
    units.select('.hp-fg').attr('width', d => Math.max(0, (d.hp / d.maxHp) * 70));

    // 이펙트 렌더링
    teamArray.forEach((d: Team) => {
      const angleRad = d.angle * (Math.PI / 180);
      const now = Date.now();

      // 1. 기본 공격 이펙트 (실제 range만큼 그림)
      if (d.lastAtkTime > (lastAtkTimes.current[d.id] || 0)) {
        lastAtkTimes.current[d.id] = d.lastAtkTime;
        const rangeMult = d.activeEffects.some(e => e.type === 'a_range') ? 3 : 1;
        const actualRange = d.stats.range * rangeMult;

        effectLayer.append('circle')
          .attr('cx', d.x).attr('cy', d.y).attr('r', 10)
          .attr('fill', 'none').attr('stroke', 'rgba(255,255,255,0.8)').attr('stroke-width', 2)
          .transition().duration(200)
          .attr('r', actualRange) // 실제 공격 판정 범위까지 확장
          .style('opacity', 0).remove();
      }

      // 2. 스킬 이펙트
      d.activeEffects.forEach(eff => {
        if (eff.until < now) return; 

        if (eff.type === 'm_laser') {
           const endX = d.x + Math.cos(angleRad) * 1000;
           const endY = d.y + Math.sin(angleRad) * 1000;
           const g = effectLayer.append('g').attr('class', 'laser-fx');
           g.append('line').attr('x1', d.x).attr('y1', d.y).attr('x2', endX).attr('y2', endY).attr('stroke', 'cyan').attr('stroke-width', 30).style('filter', 'blur(10px)');
           g.append('line').attr('x1', d.x).attr('y1', d.y).attr('x2', endX).attr('y2', endY).attr('stroke', 'white').attr('stroke-width', 8);
           g.transition().duration(400).style('opacity', 0).remove();
        }
        if (eff.type === 'm_thunder') {
           effectLayer.append('circle').attr('cx', d.x).attr('cy', d.y).attr('r', 400) // 판정 범위 400과 일치
            .attr('fill', 'rgba(255,255,0,0.1)').attr('stroke', 'yellow').attr('stroke-width', 5).style('filter', 'blur(5px)')
            .transition().duration(400).attr('r', 420).style('opacity', 0).remove();
        }
        if (eff.type === 'a_multi') {
           for(let i=-2; i<=2; i++) {
              const a = angleRad + i*0.2;
              effectLayer.append('line')
                .attr('x1', d.x).attr('y1', d.y)
                .attr('x2', d.x + Math.cos(a)*500).attr('y2', d.y + Math.sin(a)*500)
                .attr('stroke', '#fff').attr('stroke-width', 4)
                .transition().duration(300).style('opacity', 0).remove();
           }
        }
      });
    });
  }, [teams, myTeamId]);

  return (
    <div className="w-full h-full bg-[#020617] relative">
      <svg ref={svgRef} viewBox="0 0 1000 1000" className="w-full h-full" />
    </div>
  );
};
