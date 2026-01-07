
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

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    
    svg.selectAll('.main-layer').remove();
    const mainLayer = svg.append('g').attr('class', 'main-layer');
    const effectLayer = mainLayer.append('g').attr('class', 'effect-layer');
    const unitLayer = mainLayer.append('g').attr('class', 'unit-layer');

    const grid = mainLayer.append('g').attr('class', 'grid-layer').lower();
    for (let i = 0; i <= 1000; i += 100) {
      grid.append('line').attr('x1', i).attr('y1', 0).attr('x2', i).attr('y2', 1000).attr('stroke', '#1e293b').attr('stroke-width', 1).attr('opacity', 0.4);
      grid.append('line').attr('x1', 0).attr('y1', i).attr('x2', 1000).attr('y2', i).attr('stroke', '#1e293b').attr('stroke-width', 1).attr('opacity', 0.4);
    }

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
        if (d.activeEffects.some(e => e.type === 'w_invinc')) return 'drop-shadow(0 0 15px gold) brightness(1.5)';
        if (d.activeEffects.some(e => e.type === 'w_double')) return 'drop-shadow(0 0 10px red) saturate(3)';
        return 'none';
      });

    units.select('.selection-ring').attr('stroke', d => d.id === myTeamId ? '#3b82f6' : 'none').attr('opacity', d => d.id === myTeamId ? 1 : 0);
    units.select('.name').text(d => d.name);
    units.select('.hp-fg').attr('width', d => Math.max(0, (d.hp / d.maxHp) * 70));

    // 이펙트 렌더링
    teamArray.forEach((d: Team) => {
      const timeSinceAtk = Date.now() - d.lastAtkTime;
      const angleRad = d.angle * (Math.PI / 180);

      // 일반 공격 이펙트
      if (timeSinceAtk < 200) {
        if (d.classType === ClassType.WARRIOR || d.classType === ClassType.ROGUE) {
          effectLayer.append('circle').attr('cx', d.x + Math.cos(angleRad)*50).attr('cy', d.y + Math.sin(angleRad)*50).attr('r', 40).attr('fill', 'rgba(255,255,255,0.4)')
            .transition().duration(200).attr('r', 60).style('opacity', 0).remove();
        } else {
           const endX = d.x + Math.cos(angleRad) * d.stats.range;
           const endY = d.y + Math.sin(angleRad) * d.stats.range;
           effectLayer.append('line').attr('x1', d.x).attr('y1', d.y).attr('x2', endX).attr('y2', endY).attr('stroke', d.classType === ClassType.MAGE ? '#60a5fa' : '#fbbf24').attr('stroke-width', 4)
            .transition().duration(200).style('opacity', 0).remove();
        }
      }

      // 스킬 이펙트
      d.activeEffects.forEach(eff => {
        if (eff.type === 'm_laser') {
           const endX = d.x + Math.cos(angleRad) * 1200;
           const endY = d.y + Math.sin(angleRad) * 1200;
           effectLayer.append('line').attr('x1', d.x).attr('y1', d.y).attr('x2', endX).attr('y2', endY).attr('stroke', 'rgba(0,255,255,0.6)').attr('stroke-width', 40)
            .style('filter', 'blur(10px)')
            .transition().duration(200).style('opacity', 0).remove();
           effectLayer.append('line').attr('x1', d.x).attr('y1', d.y).attr('x2', endX).attr('y2', endY).attr('stroke', 'white').attr('stroke-width', 10)
            .transition().duration(200).style('opacity', 0).remove();
        }
        if (eff.type === 'm_thunder') {
           effectLayer.append('circle').attr('cx', d.x).attr('cy', d.y).attr('r', 400).attr('fill', 'none').attr('stroke', '#fbbf24').attr('stroke-width', 10).style('filter', 'blur(5px)')
            .transition().duration(500).attr('r', 450).style('opacity', 0).remove();
        }
        if (eff.type === 'w_speed') {
           effectLayer.append('circle').attr('cx', d.x).attr('cy', d.y).attr('r', 30).attr('fill', 'none').attr('stroke', '#34d399').attr('stroke-width', 5)
            .transition().duration(300).attr('r', 80).style('opacity', 0).remove();
        }
        if (eff.type === 'a_multi') {
           for(let i=-2; i<=2; i++) {
              const a = angleRad + i*0.2;
              effectLayer.append('line').attr('x1', d.x).attr('y1', d.y).attr('x2', d.x + Math.cos(a)*500).attr('y2', d.y + Math.sin(a)*500).attr('stroke', 'white').attr('stroke-width', 2)
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
