
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
    const width = 1000;
    const height = 1000;

    // 초기화 및 레이어 구성
    svg.selectAll('.main-layer').remove();
    const mainLayer = svg.append('g').attr('class', 'main-layer');
    const effectLayer = mainLayer.append('g').attr('class', 'effect-layer');
    const unitLayer = mainLayer.append('g').attr('class', 'unit-layer');

    // 배경 그리드
    const grid = mainLayer.append('g').attr('class', 'grid-layer').lower();
    for (let i = 0; i <= 1000; i += 100) {
      grid.append('line').attr('x1', i).attr('y1', 0).attr('x2', i).attr('y2', 1000).attr('stroke', '#1e293b').attr('stroke-width', 0.5);
      grid.append('line').attr('x1', 0).attr('y1', i).attr('x2', 1000).attr('y2', i).attr('stroke', '#1e293b').attr('stroke-width', 0.5);
    }

    const teamArray = Object.values(teams);
    
    // 유닛 렌더링
    const units = unitLayer.selectAll('.unit').data(teamArray, (d: any) => d.id).join(
      enter => {
        const g = enter.append('g').attr('class', 'unit');
        
        // 베이스 발판
        g.append('ellipse').attr('class', 'shadow').attr('rx', 25).attr('ry', 10).attr('cy', 20).attr('fill', 'black').attr('opacity', 0.3);
        
        // 캐릭터 바디 (동그라미 대신 감각적인 다이아몬드/실드 형태)
        g.append('path').attr('class', 'body').attr('d', 'M0 -30 L25 0 L0 30 L-25 0 Z').attr('fill', '#0f172a').attr('stroke-width', 3);
        
        // 클래스 아이콘
        g.append('text').attr('class', 'icon').attr('text-anchor', 'middle').attr('dy', '0.35em').style('font-size', '24px');
        
        // 정보 UI 레이어
        const info = g.append('g').attr('transform', 'translate(0, -60)');
        info.append('text').attr('class', 'name').attr('text-anchor', 'middle').attr('fill', 'white').style('font-size', '12px').style('font-weight', '900').style('text-shadow', '0 2px 4px black');
        
        // HP Bar
        info.append('rect').attr('class', 'hp-bg').attr('x', -25).attr('y', 5).attr('width', 50).attr('height', 5).attr('fill', '#450a0a').attr('rx', 2.5);
        info.append('rect').attr('class', 'hp-fg').attr('x', -25).attr('y', 5).attr('height', 5).attr('fill', '#ef4444').attr('rx', 2.5);
        
        // MP Bar
        info.append('rect').attr('class', 'mp-bg').attr('x', -25).attr('y', 12).attr('width', 50).attr('height', 3).attr('fill', '#082f49').attr('rx', 1.5);
        info.append('rect').attr('class', 'mp-fg').attr('x', -25).attr('y', 12).attr('height', 3).attr('fill', '#0ea5e9').attr('rx', 1.5);

        return g;
      }
    );

    units.attr('transform', d => `translate(${d.x}, ${d.y})`)
      .style('opacity', d => {
        const isHidden = d.activeEffects.some(e => e.type === 'r_hide');
        if (isHidden && d.id !== myTeamId) return 0;
        return d.isDead ? 0.2 : 1;
      });

    units.select('.body')
      .attr('stroke', d => d.id === myTeamId ? '#3b82f6' : '#f97316')
      .attr('fill', d => {
        if (d.activeEffects.some(e => e.type === 'w_invinc')) return '#facc15';
        if (d.activeEffects.some(e => e.type === 'w_double')) return '#991b1b';
        return '#0f172a';
      });

    units.select('.icon').text(d => {
      if (d.classType === ClassType.WARRIOR) return '🛡️';
      if (d.classType === ClassType.MAGE) return '🔮';
      if (d.classType === ClassType.ARCHER) return '🏹';
      return '🗡️';
    });

    units.select('.name').text(d => `${d.name} (${d.points}P)`);
    units.select('.hp-fg').attr('width', d => Math.max(0, (d.hp / d.maxHp) * 50));
    units.select('.mp-fg').attr('width', d => Math.max(0, (d.mp / d.maxMp) * 50));

    // 공격 애니메이션 로직
    teamArray.forEach((d: Team) => {
      // Fix: Cast unknown to Team type for access
      const timeSinceAtk = Date.now() - d.lastAtkTime;
      if (timeSinceAtk < 300) {
        if (d.classType === ClassType.WARRIOR) {
          // 전사: 칼 휘두르기 (Arc)
          effectLayer.append('path')
            .attr('d', d3.arc()({ innerRadius: 40, outerRadius: 65, startAngle: 0, endAngle: Math.PI })!)
            .attr('transform', `translate(${d.x}, ${d.y}) rotate(0)`)
            .attr('fill', 'white').attr('opacity', 0.6)
            .transition().duration(200).style('opacity', 0).remove();
        } else if (d.classType === ClassType.MAGE) {
          // 마법사: 파이어볼 발사
          effectLayer.append('circle')
            .attr('cx', d.x).attr('cy', d.y).attr('r', 8)
            .attr('fill', '#f97316')
            .style('filter', 'blur(2px)')
            .transition().duration(300)
            .attr('cx', d.x + 150).attr('cy', d.y) // 예시로 오른쪽 발사
            .style('opacity', 0).remove();
        } else if (d.classType === ClassType.ARCHER) {
          // 궁수: 화살
          effectLayer.append('line')
            .attr('x1', d.x).attr('y1', d.y).attr('x2', d.x + 20).attr('y2', d.y)
            .attr('stroke', '#94a3b8').attr('stroke-width', 2)
            .transition().duration(200)
            .attr('x1', d.x + 300).attr('x2', d.x + 320)
            .style('opacity', 0).remove();
        } else if (d.classType === ClassType.ROGUE) {
          // 도적: 쌍단검 잔상
          effectLayer.append('path')
            .attr('d', 'M-10 -10 L10 10 M-10 10 L10 -10')
            .attr('transform', `translate(${d.x + 20}, ${d.y})`)
            .attr('stroke', 'white').attr('stroke-width', 3)
            .transition().duration(150).style('opacity', 0).remove();
        }
      }

      // 특수 스킬 이펙트
      d.activeEffects.forEach(effect => {
        if (effect.type === 'm_laser') {
          effectLayer.append('rect')
            .attr('x', d.x).attr('y', d.y - 10).attr('width', 1000).attr('height', 20)
            .attr('fill', 'rgba(14, 165, 233, 0.4)')
            .transition().duration(100).style('opacity', 0).remove();
        }
        if (effect.type === 'm_thunder') {
          effectLayer.append('circle')
            .attr('cx', d.x).attr('cy', d.y).attr('r', 300)
            .attr('fill', 'none').attr('stroke', 'yellow').attr('stroke-width', 5)
            .attr('stroke-dasharray', '10, 5')
            .transition().duration(200).style('opacity', 0).remove();
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