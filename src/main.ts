/**
 * 《熵减战争》 (Entropy Reduction War) - Ver 0.4 "The Network"
 * 核心升级：严格的网状防御、侧翼包抄逻辑、战术变道
 */

// ==========================================
// 1. 全局配置
// ==========================================
const CONFIG = {
  WIDTH: 1200,
  HEIGHT: 800,
  LANE_COUNT: 3,
  FPS: 60,
  BLOCKADE_THRESHOLD: 2000,
  THEME: {
    BG: '#050510',
    GRID: 'rgba(255,255,255,0.03)',
    PLAYER: '#00f2ff',
    ENEMY: '#ff0055',
  }
};

enum UnitType {
  SHIELD = 'SHIELD',
  CROSSBOW = 'CROSSBOW',
  CAVALRY = 'CAVALRY',
  TOWER = 'TOWER'
}

enum Faction {
  PLAYER = 1,
  ENEMY = -1
}

const UNIT_STATS = {
  [UnitType.SHIELD]:   { hp: 450,  dmg: 10, range: 50,  speed: 0.6, radius: 16, cost: 120, count: 3, mass: 20, label: '重装盾卫' },
  [UnitType.CROSSBOW]: { hp: 100,  dmg: 40, range: 220, speed: 0.9, radius: 10, cost: 150, count: 4, mass: 5,  label: '相位弩手' },
  [UnitType.CAVALRY]:  { hp: 300,  dmg: 25, range: 35,  speed: 2.2, radius: 14, cost: 200, count: 2, mass: 12, label: '突袭骑兵' },
  [UnitType.TOWER]:    { hp: 3500, dmg: 70, range: 280, speed: 0,   radius: 40, cost: 0,   count: 1, mass: 9999, label: '' }
};

const DAMAGE_MATRIX = {
  [UnitType.SHIELD]:   { [UnitType.SHIELD]: 1.0, [UnitType.CROSSBOW]: 1.5, [UnitType.CAVALRY]: 0.5, [UnitType.TOWER]: 0.5 },
  [UnitType.CROSSBOW]: { [UnitType.SHIELD]: 0.5, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 2.0, [UnitType.TOWER]: 1.2 },
  [UnitType.CAVALRY]:  { [UnitType.SHIELD]: 2.0, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0.4 },
  [UnitType.TOWER]:    { [UnitType.SHIELD]: 0.8, [UnitType.CROSSBOW]: 1.2, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0 }
};

// ==========================================
// 2. 实体类
// ==========================================

class Wreckage {
  x: number; y: number; value: number; radius: number = 6; markedForDeletion: boolean = false;
  constructor(x: number, y: number, cost: number) {
    this.x = x; this.y = y; this.value = (cost / 2) * 0.6;
  }
  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#666'; ctx.beginPath(); ctx.arc(this.x, this.y, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#aff'; ctx.font = '10px monospace'; ctx.fillText('+', this.x+5, this.y);
  }
}

class Unit {
  id: number; x: number; y: number;
  type: UnitType; faction: Faction;
  
  // 核心 AI 状态
  currentLane: number; // 当前所在的逻辑车道 (0,1,2)
  targetLane: number;  // 想要去的车道 (用于变道)
  laneSwitchCooldown: number = 0;

  currentHp: number; maxHp: number; currentDmg: number;
  vx: number = 0; vy: number = 0;
  radius: number; mass: number; 
  cooldown: number = 0; isDead: boolean = false; isStatic: boolean = false;
  hitFlash: number = 0;

  constructor(id: number, type: UnitType, faction: Faction, x: number, y: number, lane: number) {
    this.id = id; this.type = type; this.faction = faction;
    this.x = x; this.y = y;
    this.currentLane = lane;
    this.targetLane = lane; // 初始目标车道等于出生车道
    
    const stats = UNIT_STATS[type];
    this.maxHp = stats.hp; this.currentHp = stats.hp;
    this.radius = stats.radius; this.mass = stats.mass;
    this.isStatic = (stats.speed === 0);
  }

  // 检查是否处于“变道区” (Crossroad Zone)
  // 变道区定义：在防御塔 (无论死活) 的X轴附近
  isInCrossroadZone(): boolean {
    const zones = [120, 300, CONFIG.WIDTH - 120, CONFIG.WIDTH - 300]; // 塔的X坐标
    return zones.some(z => Math.abs(this.x - z) < 60); // 120px 宽度的变道窗口
  }

  // AI 核心：战术决策
  think(units: Unit[]) {
    if (this.isStatic) return;
    if (this.laneSwitchCooldown > 0) { this.laneSwitchCooldown--; return; }

    // 只有在变道区才能思考变道
    if (!this.isInCrossroadZone()) return;

    const myLaneIdx = this.targetLane;
    // 获取相邻车道
    const neighbors = [];
    if (myLaneIdx > 0) neighbors.push(myLaneIdx - 1);
    if (myLaneIdx < 2) neighbors.push(myLaneIdx + 1);

    // 1. 进攻性变道 (Flanking)：如果你前面的塔没了，但隔壁有塔，去侧翼包抄
    // 寻找我方视野内最近的敌方塔
    const nearbyEnemyTowers = units.filter(u => 
        u.faction !== this.faction && 
        u.type === UnitType.TOWER && 
        !u.isDead &&
        Math.abs(u.x - this.x) < 400 // 视野范围
    );

    // 如果本路没有敌塔，但隔壁路有敌塔 -> 变道去打它
    const enemyTowerInMyLane = nearbyEnemyTowers.some(t => Math.floor(t.y / (CONFIG.HEIGHT/3)) === myLaneIdx);
    
    if (!enemyTowerInMyLane) {
        for (const nIdx of neighbors) {
            const enemyTowerInNeighbor = nearbyEnemyTowers.find(t => Math.floor(t.y / (CONFIG.HEIGHT/3)) === nIdx);
            if (enemyTowerInNeighbor) {
                // 发现侧翼目标！变道！
                this.targetLane = nIdx;
                this.laneSwitchCooldown = 120; // 2秒冷却
                // 视觉反馈：头上冒个感叹号
                Game.instance.vfx.push({type: 'text', x: this.x, y: this.y - 20, text: '!', color: '#fff', life: 30});
                return;
            }
        }
    }

    // 2. 防守性变道 (Support)：本路没事干，隔壁在挨揍
    // 略微简化：如果本路前方无敌人，隔壁前方有大量敌人，则变道
    // (MVP暂略，优先实现进攻包抄)
  }

  update(dt: number, units: Unit[], wreckages: Wreckage[]) {
    if (this.isDead) return;
    if (this.hitFlash > 0) this.hitFlash--;

    // 思考战术
    this.think(units);

    // 索敌
    let target: Unit | null = null;
    let minDist = Infinity;
    const range = UNIT_STATS[this.type].range;

    for (const u of units) {
      if (u.faction !== this.faction && !u.isDead) {
        const d = Math.sqrt((u.x - this.x)**2 + (u.y - this.y)**2);
        if (d < minDist) { minDist = d; target = u; }
      }
    }

    // 战斗与移动
    if (target && minDist <= range + target.radius) {
      if (this.cooldown <= 0) {
        this.attack(target);
        this.cooldown = 60;
      } else this.cooldown--;
      if (!this.isStatic) { this.vx *= 0.5; this.vy *= 0.5; } 
    } else {
      // --- 移动逻辑重写：基于 targetLane ---
      if (!this.isStatic) {
        const dir = this.faction === Faction.PLAYER ? 1 : -1;
        const spd = UNIT_STATS[this.type].speed;
        
        // X轴推进
        this.vx += dir * spd * 0.1;
        
        // Y轴：强力导向 targetLane
        const laneH = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
        const targetY = this.targetLane * laneH + laneH/2;
        
        // 变道时赋予额外的 Y轴 力
        const dy = targetY - this.y;
        this.vy += dy * 0.01; // 导向力

        // 速度限制
        const currSpd = Math.sqrt(this.vx**2 + this.vy**2);
        if (currSpd > spd * 1.5) { // 变道允许稍微超速
          this.vx = (this.vx / currSpd) * spd;
          this.vy = (this.vy / currSpd) * spd;
        }

        this.x += this.vx; this.y += this.vy;
      }
    }

    // 回收资源
    if (!this.isStatic) {
      for (const w of wreckages) {
        if (!w.markedForDeletion && Math.hypot(w.x - this.x, w.y - this.y) < this.radius + 15) {
            Game.instance.addResource(this.faction, w.value);
            w.markedForDeletion = true;
        }
      }
    }
  }

  attack(target: Unit) {
    const mult = DAMAGE_MATRIX[this.type][target.type];
    target.takeDamage(this.currentDmg || UNIT_STATS[this.type].dmg * mult);
    // 视觉
    const color = this.faction === Faction.PLAYER ? CONFIG.THEME.PLAYER : CONFIG.THEME.ENEMY;
    Game.instance.vfx.push({type: 'beam', x1:this.x, y1:this.y, x2:target.x, y2:target.y, color, life:8});
  }

  takeDamage(amt: number) {
    this.currentHp -= amt; this.hitFlash = 3;
    if (this.currentHp <= 0) {
      this.isDead = true;
      if (!this.isStatic) Game.instance.spawnWreckage(this.x, this.y, UNIT_STATS[this.type].cost);
      if (this.type === UnitType.TOWER) Game.instance.shake = 15;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.x, this.y);
    let color = this.faction === Faction.PLAYER ? CONFIG.THEME.PLAYER : CONFIG.THEME.ENEMY;
    if (this.hitFlash > 0) color = '#fff';
    
    ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.shadowBlur = 10; ctx.shadowColor = color;
    
    if (this.type === UnitType.TOWER) {
        ctx.beginPath(); 
        for(let i=0; i<6; i++) ctx.lineTo(Math.cos(i*Math.PI/3)*30, Math.sin(i*Math.PI/3)*30);
        ctx.closePath(); ctx.stroke();
        ctx.globalAlpha = this.currentHp/this.maxHp; ctx.fill();
    } else {
        // 简单的单位形状
        ctx.beginPath(); ctx.arc(0,0, this.radius, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
}

// ==========================================
// 3. 游戏主控
// ==========================================

class Game {
  static instance: Game;
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  units: Unit[] = []; wreckages: Wreckage[] = []; vfx: any[] = [];
  playerRes: number = 600; enemyRes: number = 600;
  shake: number = 0; idCounter: 0;
  
  constructor() {
    Game.instance = this;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CONFIG.WIDTH; this.canvas.height = CONFIG.HEIGHT;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.initWorld();
    this.createControls();
    this.loop(0);
    setInterval(() => this.enemyAI(), 2000);
  }

  initWorld() {
    const laneH = CONFIG.HEIGHT/3;
    for(let i=0; i<3; i++) {
        const cy = i*laneH + laneH/2;
        // 玩家双塔
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.PLAYER, 120, cy, i));
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.PLAYER, 300, cy, i));
        // 敌人双塔
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.ENEMY, CONFIG.WIDTH-120, cy, i));
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.ENEMY, CONFIG.WIDTH-300, cy, i));
    }
  }

  spawnSquad(f: Faction, type: UnitType, lane: number) {
    const cost = UNIT_STATS[type].cost;
    if (f === Faction.PLAYER) {
        if (this.playerRes < cost) return;
        this.playerRes -= cost;
    }
    const laneH = CONFIG.HEIGHT/3;
    const cy = lane*laneH + laneH/2;
    const bx = f === Faction.PLAYER ? 40 : CONFIG.WIDTH-40;
    
    for(let i=0; i<UNIT_STATS[type].count; i++) {
        const u = new Unit(this.idCounter++, type, f, bx + (Math.random()-0.5)*30, cy + (Math.random()-0.5)*30, lane);
        this.units.push(u);
    }
  }
  
  spawnWreckage(x, y, cost) { this.wreckages.push(new Wreckage(x, y, cost)); }
  addResource(f, val) { if(f===Faction.PLAYER) this.playerRes += val; else this.enemyRes += val; }

  enemyAI() {
      // 简单AI：往兵少的那一路出兵
      const laneCounts = [0,0,0];
      this.units.forEach(u => { if(u.faction===Faction.ENEMY && !u.isStatic) laneCounts[u.targetLane]++ });
      const minLane = laneCounts.indexOf(Math.min(...laneCounts));
      const types = [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY];
      this.spawnSquad(Faction.ENEMY, types[Math.floor(Math.random()*3)], minLane);
  }

  update(dt: number) {
    // 物理引擎：友军穿透 (Ghosting) + 敌军阻挡 + Boids
    for (let i=0; i<this.units.length; i++) {
        for (let j=i+1; j<this.units.length; j++) {
            const u1 = this.units[i]; const u2 = this.units[j];
            if (u1.isDead || u2.isDead) continue;
            
            // 友军塔不挡路
            if (u1.faction === u2.faction && (u1.type===UnitType.TOWER || u2.type===UnitType.TOWER)) continue;
            // 塔之间无碰撞
            if (u1.isStatic && u2.isStatic) continue;

            const dx = u2.x - u1.x; const dy = u2.y - u1.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const minDist = u1.radius + u2.radius + 2;

            if (dist < minDist) {
                const push = (minDist - dist) / 2;
                const nx = dx/dist; const ny = dy/dist;
                const totalM = u1.mass + u2.mass;
                if(!u1.isStatic) { u1.x -= nx * push * (u2.mass/totalM); u1.y -= ny * push * (u2.mass/totalM); }
                if(!u2.isStatic) { u2.x += nx * push * (u1.mass/totalM); u2.y += ny * push * (u1.mass/totalM); }
            }
        }
    }

    // 漏斗地形约束 (Respect targetLane)
    this.units.forEach(u => {
        if (u.isStatic) return;
        const laneH = CONFIG.HEIGHT/3;
        const targetCy = u.targetLane * laneH + laneH/2;
        
        // 如果正在变道，放宽约束；如果在本车道，收紧约束
        const isSwitching = u.currentLane !== u.targetLane;
        const widthConstraint = isSwitching ? laneH/2 : (laneH/2 - 20) * 0.8; 
        
        if (u.y > targetCy + widthConstraint) u.y -= 2;
        if (u.y < targetCy - widthConstraint) u.y += 2;
        
        // 如果到达目标车道中心附近，更新 currentLane
        if (Math.abs(u.y - targetCy) < 20) u.currentLane = u.targetLane;
        
        u.update(dt, this.units, this.wreckages);
    });

    this.units = this.units.filter(u => !u.isDead);
    this.wreckages = this.wreckages.filter(w => !w.markedForDeletion);
    this.playerRes += 0.5;
    if(this.shake>0) this.shake *= 0.9;
  }

  draw() {
    const ctx = this.ctx;
    ctx.save();
    if(this.shake > 0.5) ctx.translate((Math.random()-0.5)*this.shake, (Math.random()-0.5)*this.shake);
    
    // BG
    ctx.fillStyle = CONFIG.THEME.BG; ctx.fillRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
    
    // Draw "Crossroad" Zones (视觉化变道区)
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    [120, 300, CONFIG.WIDTH-120, CONFIG.WIDTH-300].forEach(x => {
        ctx.fillRect(x-40, 0, 80, CONFIG.HEIGHT);
    });

    // Draw Bridges (连廊)
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.setLineDash([5,5]); ctx.lineWidth = 2;
    const towers = this.units.filter(u => u.type === UnitType.TOWER);
    for(let i=0; i<towers.length; i++) {
        for(let j=i+1; j<towers.length; j++) {
            const t1 = towers[i]; const t2 = towers[j];
            if(t1.faction === t2.faction && Math.abs(t1.x - t2.x) < 50 && Math.abs(t1.y - t2.y) < CONFIG.HEIGHT/2 + 50) {
                ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.stroke();
            }
        }
    }
    ctx.setLineDash([]);

    this.wreckages.forEach(w => w.draw(ctx));
    this.units.forEach(u => u.draw(ctx));
    
    // VFX
    this.vfx.forEach(v => {
        if(v.type === 'beam') {
            ctx.strokeStyle = v.color; ctx.beginPath(); ctx.moveTo(v.x1, v.y1); ctx.lineTo(v.x2, v.y2); ctx.stroke();
        } else if (v.type === 'text') {
            ctx.fillStyle = v.color; ctx.fillText(v.text, v.x, v.y); v.y -= 1;
        }
        v.life--;
    });
    this.vfx = this.vfx.filter(v => v.life > 0);
    
    ctx.restore();
    this.drawUI();
  }

  drawUI() {
      this.ctx.fillStyle = '#fff'; this.ctx.font = '20px monospace';
      this.ctx.fillText(`RES: ${Math.floor(this.playerRes)}`, 20, 30);
  }

  createControls() {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;bottom:10px;left:50%;transform:translate(-50%);display:flex;gap:20px;background:#000;padding:10px;border:1px solid #333;';
    ['TOP','MID','BOT'].forEach((l, i) => {
        const g = document.createElement('div'); g.style.display='flex'; g.style.flexDirection='column';
        const txt = document.createElement('div'); txt.innerText=l; txt.style.color='#888'; txt.style.textAlign='center'; g.appendChild(txt);
        [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY].forEach(t => {
            const b = document.createElement('button');
            b.innerText = `${UNIT_STATS[t].label}`;
            b.style.cssText = `background:#222;color:${CONFIG.THEME.PLAYER};border:1px solid #444;margin:2px;cursor:pointer;`;
            b.onclick = () => this.spawnSquad(Faction.PLAYER, t, i);
            g.appendChild(b);
        });
        box.appendChild(g);
    });
    document.body.appendChild(box);
  }

  loop(ts) {
    this.update(ts); this.draw(); requestAnimationFrame(this.loop.bind(this));
  }
}

new Game();
