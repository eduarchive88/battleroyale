
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

    // Draw grid
    svg.selectAll('.grid').remove();
    const grid = svg.append('g').attr('class', 'grid');
    for (let i = 0; i <= width; i += 50) {
      grid.append('line').attr('x1', i).attr('y1', 0).attr('x2', i).attr('y2', height).attr('stroke', '#1e293b').attr('stroke-width', 1);
      grid.append('line').attr('x1', 0).attr('y1', i).attr('x2', width).attr('y2', i).attr('stroke', '#1e293b').attr('stroke-width', 1);
    }

    // Draw Obstacles (Mock)
    const obstacles = [
      { x: 200, y: 200, w: 100, h: 50 },
      { x: 700, y: 300, w: 50, h: 150 },
      { x: 400, y: 600, w: 200, h: 20 },
    ];
    svg.selectAll('.obstacle').data(obstacles).join('rect')
      .attr('class', 'obstacle')
      .attr('x', d => d.x).attr('y', d => d.y)
      .attr('width', d => d.w).attr('height', d => d.h)
      .attr('fill', '#334155').attr('rx', 4);

    // Draw Teams
    const teamArray = Object.values(teams);
    
    const teamGroups = svg.selectAll('.team-unit').data(teamArray, (d: any) => d.id).join(
      enter => {
        const g = enter.append('g').attr('class', 'team-unit');
        g.append('circle').attr('class', 'body').attr('r', 15);
        g.append('text').attr('class', 'label').attr('dy', -25).attr('text-anchor', 'middle').attr('fill', 'white').style('font-size', '12px');
        g.append('rect').attr('class', 'hp-bg').attr('x', -20).attr('y', -40).attr('width', 40).attr('height', 5).attr('fill', '#ef4444');
        g.append('rect').attr('class', 'hp-fg').attr('x', -20).attr('y', -40).attr('height', 5).attr('fill', '#22c55e');
        return g;
      },
      update => update,
      exit => exit.remove()
    );

    teamGroups.transition().duration(100)
      .attr('transform', d => `translate(${d.x}, ${d.y})`);

    teamGroups.select('.body')
      .attr('fill', d => d.id === myTeamId ? '#3b82f6' : '#f97316')
      .attr('stroke', d => d.isDead ? '#333' : '#fff')
      .attr('opacity', d => d.isDead ? 0.3 : 1);

    teamGroups.select('.label').text(d => d.name);

    teamGroups.select('.hp-fg')
      .attr('width', d => Math.max(0, (d.hp / d.maxHp) * 40));

  }, [teams, myTeamId]);

  return (
    <div className="w-full h-full overflow-hidden bg-slate-900 rounded-xl border border-slate-700 relative">
      <svg 
        ref={svgRef} 
        viewBox="0 0 1000 1000" 
        className="w-full h-full"
        style={{ cursor: 'crosshair' }}
      />
    </div>
  );
};
