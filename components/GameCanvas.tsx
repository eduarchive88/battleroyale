
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Team, ClassType } from '../types';

interface GameCanvasProps {
  teams: Record<string, Team>;
  myTeamId?: string;
}

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
        g.append('ellipse').attr('class', 'shadow').attr('rx', 30).attr('ry', 12).attr('cy', 22).attr('fill', 'black').attr('opacity', 0.4);
        g.append('path').attr('class', 'body').attr('d', 'M0 -35 L30 0 L0 35 L-30 0 Z').attr('fill', '#0f172a').attr('stroke-width', 4);
        g.append('text').attr('class', 'icon').attr('text-anchor', 'middle').attr('dy', '0.35em').style('font-size', '28px');
        const info = g.append('g').attr('transform', 'translate(0, -65)');
        info.append('text').attr('class', 'name').attr('text-anchor', 'middle').attr('fill', 'white').style('font-size', '12px').style('font-weight', '900').style('text-shadow', '0 2px 4px black');
        info.append('rect').attr('class', 'hp-bg').attr('x', -30).attr('y', 5).attr('width', 60).attr('height', 6).attr('fill', '#450a0a').attr('rx', 3);
        info.append('rect').attr('class', 'hp-fg').attr('x', -30).attr('y', 5).attr('height', 6).attr('fill', '#ef4444').attr('rx', 3);
        return g;
      }
    );

    units.attr('transform', d => `translate(${d.x}, ${d.y}) rotate(${d.angle})`)
      .style('opacity', d => {
        const isHidden = d.activeEffects.some(e => e.type === 'r_hide');
        if (isHidden && d.id !== myTeamId) return 0;
        return d.isDead ? 0.15 : 1;
      });

    // 보조 UI는 회전하지 않도록 역회전 처리
    units.select('g').attr('transform', d => `rotate(${-d.angle})`);
    units.select('.icon').attr('transform', d => `rotate(${-d.angle})`);

    units.select('.body')
      .attr('stroke', d => d.id === myTeamId ? '#3b82f6' : '#f97316')
      .attr('fill', d => {
        if (d.activeEffects.some(e => e.type === 'w_invinc')) return '#facc15';
        if (d.activeEffects.some(e => e.type === 'w_double')) return '#991b1b';
        return '#0f172a';
      })
      .style('filter', d => d.id === myTeamId ? 'drop-shadow(0 0 10px #3b82f6)' : 'none');

    units.select('.icon').text(d => {
      if (d.classType === ClassType.WARRIOR) return '🛡️';
      if (d.classType === ClassType.MAGE) return '🔮';
      if (d.classType === ClassType.ARCHER) return '🏹';
      return '🗡️';
    });

    units.select('.hp-fg').attr('width', d => Math.max(0, (d.hp / d.maxHp) * 60));

    // 클래스별 360도 공격 및 스킬 이펙트
    teamArray.forEach((d: Team) => {
      const timeSinceAtk = Date.now() - d.lastAtkTime;
      const angleRad = d.angle * (Math.PI / 180);

      if (timeSinceAtk < 300) {
        if (d.classType === ClassType.WARRIOR) {
          // 전사: 90도 부채꼴 휘두르기
          const arc = d3.arc()({ innerRadius: 20, outerRadius: 80, startAngle: angleRad - Math.PI/4, endAngle: angleRad + Math.PI/4 });
          effectLayer.append('path').attr('d', arc!).attr('fill', 'rgba(255,255,255,0.4)').attr('transform', `translate(${d.x}, ${d.y})`)
            .transition().duration(250).style('opacity', 0).remove();
        } else if (d.classType === ClassType.ROGUE) {
          // 도적: 타격 지점 X자 난도질
          const tx = d.x + Math.cos(angleRad) * 60;
          const ty = d.y + Math.sin(angleRad) * 60;
          effectLayer.append('path').attr('d', `M${tx-20},${ty-20} L${tx+20},${ty+20} M${tx+20},${ty-20} L${tx-20},${ty+20}`)
            .attr('stroke', '#fff').attr('stroke-width', 4).transition().duration(200).style('opacity', 0).remove();
        } else if (d.classType === ClassType.MAGE) {
          // 마법사: 날아가는 파이어볼
          const startX = d.x; const startY = d.y;
          const endX = d.x + Math.cos(angleRad) * 300;
          const endY = d.y + Math.sin(angleRad) * 300;
          effectLayer.append('circle').attr('cx', startX).attr('cy', startY).attr('r', 10).attr('fill', '#f97316').style('filter', 'blur(3px)')
            .transition().duration(300).attr('cx', endX).attr('cy', endY).style('opacity', 0).remove();
        } else if (d.classType === ClassType.ARCHER) {
          // 궁수: 직선 화살
          const endX = d.x + Math.cos(angleRad) * 400;
          const endY = d.y + Math.sin(angleRad) * 400;
          effectLayer.append('line').attr('x1', d.x).attr('y1', d.y).attr('x2', endX).attr('y2', endY).attr('stroke', '#94a3b8').attr('stroke-width', 2)
            .transition().duration(200).style('opacity', 0).remove();
        }
      }

      // 스킬 이펙트 특수 처리
      d.activeEffects.forEach(eff => {
        if (eff.type === 'm_laser') {
           const endX = d.x + Math.cos(angleRad) * 1000;
           const endY = d.y + Math.sin(angleRad) * 1000;
           effectLayer.append('line').attr('x1', d.x).attr('y1', d.y).attr('x2', endX).attr('y2', endY).attr('stroke', 'rgba(100,200,255,0.7)').attr('stroke-width', 20)
            .transition().duration(100).style('opacity', 0).remove();
        }
        if (eff.type === 'w_invinc') {
          unitLayer.select(`[data-id="${d.id}"]`).select('.body').attr('stroke', '#facc15').attr('stroke-width', 8);
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
