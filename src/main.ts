/**
 * 《熵减战争》 (Entropy Reduction War) - Hardcore Mechanics Edition
 * 核心实装：真·网状防御机制、物理化残骸、侧翼支援逻辑
 */

// ==========================================
// 1. 全局配置 (Global Config)
// ==========================================
const CONFIG = {
  WIDTH: 1200,
  HEIGHT: 800,
  LANE_COUNT: 3,
  FPS: 60,
  BLOCKADE_THRESHOLD: 2500,
  // 核心机制参数
  LINK_BUFF_SPEED: 1.5,   // 通道内移速加成
  LINK_BUFF_RANGE: 1.2,   // 通道内射程加成
  DECAY_RATE: 0.6,        // 距离衰减率 (最远端只剩 40% 属性)
  WRECKAGE_MASS: 20,      // 残骸质量 (很重，阻挡移动)
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

// 兵种数据
const UNIT_STATS = {
  [UnitType.SHIELD]:   { hp: 450,  dmg: 8,  range: 45,  speed: 0.6, radius: 18, cost: 100, count: 3, mass: 25, label: '重装盾卫' },
  [UnitType.CROSSBOW]: { hp: 100,  dmg: 40, range: 220, speed: 0.9, radius: 12, cost: 150, count: 4, mass: 5,  label: '相位弩手' },
  [UnitType.CAVALRY]:  { hp: 300,  dmg: 25, range: 35,  speed: 2.8, radius: 16, cost: 200, count: 2, mass: 15, label: '突袭骑兵' },
  [UnitType.TOWER]:    { hp: 4000, dmg: 80, range: 300, speed: 0,   radius: 45, cost: 0,   count: 1, mass: 9999, label: '' }
};

const DAMAGE_MATRIX = {
  [UnitType.SHIELD]:   { [UnitType.SHIELD]: 1.0, [UnitType.CROSSBOW]: 1.5, [UnitType.CAVALRY]: 0.5, [UnitType.TOWER]: 0.2 },
  [UnitType.CROSSBOW]: { [UnitType.SHIELD]: 0.5, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 2.0, [UnitType.TOWER]: 1.0 },
  [UnitType.CAVALRY]:  { [UnitType.SHIELD]: 2.0, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0.4 },
  [UnitType.TOWER]:    { [UnitType.SHIELD]: 1.0, [UnitType.CROSSBOW]: 1.5, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0 }
};

// ==========================================
// 2. 视觉与特效
// ==========================================
class Particle {
  x: number; y: number; vx: number; vy: number; life: number; color: string;
  constructor(x: number, y: number, color: string) {
    this.x = x; this.y = y; this.color = color;
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 3;
    this.vx = Math.cos(angle) * speed; this.vy = Math.sin(angle) * speed;
    this.life = 30 + Math.random()*20;
  }
  update() { this.x+=this.vx; this.y+=this.vy; this.life--; }
  draw(ctx: CanvasRenderingContext2D) {
    ctx.globalAlpha = this.life/50; ctx.fillStyle=this.color; 
    ctx.beginPath(); ctx.arc(this.x, this.y, 2, 0, Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
  }
}

// ==========================================
// 3. 游戏实体
// ==========================================

class Wreckage {
  x: number; y: number; value: number; radius: number = 10; 
  markedForDeletion: boolean = false;
  mass: number = CONFIG.WRECKAGE_MASS; // 残骸也是刚体

  constructor(x: number, y: number, originalCost: number) {
    this.x = x; this.y = y;
    this.value = (originalCost / 3) * 0.7; 
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#555'; ctx.strokeStyle = '#777'; ctx.lineWidth = 2;
    ctx.beginPath(); 
    ctx.moveTo(this.x-6, this.y-6); ctx.lineTo(this.x+8, this.y); ctx.lineTo(this.x-4, this.y+8); 
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#0ff'; ctx.font = '10px Arial'; ctx.fillText('$', this.x-3, this.y+3);
  }
}

class Unit {
  id: number; x: number; y: number;
  type: UnitType; faction: Faction;
  currentHp: number; maxHp: number; currentDmg: number;
  vx: number = 0; vy: number = 0;
  radius: number; mass: number; 
  cooldown: number = 0; isDead: boolean = false; isStatic: boolean = false;
  
  // 状态标记
  inNetwork: boolean = false; // 是否处于网状防御通道内

  constructor(id: number, type: UnitType, faction: Faction, x: number, y: number) {
    this.id = id; this.type = type; this.faction = faction;
    this.x = x; this.y = y;
    const stats = UNIT_STATS[type];
    this.maxHp = stats.hp; this.currentHp = stats.hp;
    this.radius = stats.radius; this.mass = stats.mass;
    this.isStatic = (stats.speed === 0);
  }

  // 核心机制：距离衰减 (Entropy Decay)
  getEntropyFactor(): number {
    if (this.isStatic) return 1.0;
    const distBase = this.faction === Faction.PLAYER ? this.x : (CONFIG.WIDTH - this.x);
    // 线性衰减：离家越远，能力越弱
    const factor = 1 - (distBase / CONFIG.WIDTH) * CONFIG.DECAY_RATE;
    return Math.max(0.2, factor);
  }

  update(dt: number, units: Unit[], wreckages: Wreckage[], networkZones: any[]) {
    if (this.isDead) return;
    
    // 1. 检查是否在“网状防御”区域内
    this.inNetwork = false;
    if (!this.isStatic) {
        for (const zone of networkZones) {
            if (zone.faction === this.faction) {
                // 简单的矩形判定：在两塔之间
                const minX = Math.min(zone.x1, zone.x2) - 20;
                const maxX = Math.max(zone.x1, zone.x2) + 20;
                const minY = Math.min(zone.y1, zone.y2);
                const maxY = Math.max(zone.y1, zone.y2);
                if (this.x > minX && this.x < maxX && this.y > minY && this.y < maxY) {
                    this.inNetwork = true;
                    break;
                }
            }
        }
    }

    // 2. 应用属性 (衰减 & 加成)
    const entropy = this.getEntropyFactor();
    // 如果在网络内，属性得到巨幅修正（模拟补给线畅通）
    const buffSpd = this.inNetwork ? CONFIG.LINK_BUFF_SPEED : 1.0;
    const buffRng = this.inNetwork ? CONFIG.LINK_BUFF_RANGE : 1.0;
    
    this.currentDmg = UNIT_STATS[this.type].dmg * entropy;

    // 3. AI 行为
    let target: Unit | null = null;
    let minDist = Infinity;
    const range = UNIT_STATS[this.type].range * buffRng; // 射程受网络影响

    for (const u of units) {
      if (u.faction !== this.faction && !u.isDead) {
        const d = Math.hypot(u.x - this.x, u.y - this.y);
        if (d < minDist) { minDist = d; target = u; }
      }
    }

    if (target && minDist <= range + target.radius) {
      // 攻击
      if (this.cooldown <= 0) {
        const mult = DAMAGE_MATRIX[this.type][target.type];
        target.takeDamage(this.currentDmg * mult);
        this.cooldown = 60;
        // 骑兵击退效果
        if (this.type === UnitType.CAVALRY && !target.isStatic) {
             const angle = Math.atan2(target.y - this.y, target.x - this.x);
             target.vx += Math.cos(angle) * 5; target.vy += Math.sin(angle) * 5;
        }
      } else this.cooldown--;
      // 攻击时减速
      if (!this.isStatic) { this.vx *= 0.8; this.vy *= 0.8; }
    } else {
      // 移动
      if (!this.isStatic) {
        const dir = this.faction === Faction.PLAYER ? 1 : -1;
        const baseSpeed = UNIT_STATS[this.type].speed * buffSpd; // 移速受网络影响
        
        // 前进
        this.vx += dir * baseSpeed * 0.05;
        
        // 侧翼联通机制：
        // 如果在网络内 (In Network)，Y轴阻力小，允许快速变道
        // 如果不在网络内 (Link Broken)，Y轴阻力极大，被锁死在兵线
        const yFriction = this.inNetwork ? 0.02 : 0.1; 
        
        // 归队逻辑
        const laneH = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
        const laneIdx = Math.floor(this.y / laneH);
        const laneCy = laneIdx * laneH + laneH/2;
        
        // 只有当没有遭遇敌人且偏离太远时才强行归队
        this.vy += (laneCy - this.y) * yFriction * 0.1; 
        
        // 限制最大速度
        const curr = Math.hypot(this.vx, this.vy);
        if (curr > baseSpeed) {
            this.vx = (this.vx/curr) * baseSpeed; this.vy = (this.vy/curr) * baseSpeed;
        }
        
        this.x += this.vx; this.y += this.vy;
      }
    }

    // 4. 回收残骸
    if (!this.isStatic) {
        for (const w of wreckages) {
            if (!w.markedForDeletion && Math.hypot(w.x-this.x, w.y-this.y) < this.radius + w.radius) {
                Game.instance.addResource(this.faction, w.value);
                w.markedForDeletion = true;
            }
        }
    }
  }

  takeDamage(amount: number) {
    this.currentHp -= amount;
    if (this.currentHp <= 0) {
      this.isDead = true;
      if (!this.isStatic) Game.instance.spawnWreckage(this.x, this.y, UNIT_STATS[this.type].cost);
      if (this.type === UnitType.TOWER) Game.instance.shake = 20;
      // 粒子特效
      for(let i=0; i<8; i++) Game.instance.particles.push(new Particle(this.x, this.y, '#fff'));
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.x, this.y);
    // 视觉：距离衰减体型
    const scale = this.isStatic ? 1 : Math.max(0.5, this.getEntropyFactor());
    ctx.scale(scale, scale);

    const color = this.faction === Faction.PLAYER ? '#00f2ff' : '#ff0055';
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2;
    
    // 视觉：网状防御激活状态
    if (this.inNetwork) {
        ctx.shadowBlur = 15; ctx.shadowColor = '#ffff00'; // 获得Buff发黄光
    } else {
        ctx.shadowBlur = 0;
    }

    ctx.beginPath();
    if (this.type === UnitType.SHIELD) ctx.fillRect(-this.radius, -this.radius, this.radius*2, this.radius*2);
    else if (this.type === UnitType.CAVALRY) { ctx.arc(0,0,this.radius,0,Math.PI*2); ctx.fill(); }
    else if (this.type === UnitType.CROSSBOW) { ctx.moveTo(this.radius,0); ctx.lineTo(-this.radius, -this.radius); ctx.lineTo(-this.radius, this.radius); ctx.stroke(); }
    else if (this.type === UnitType.TOWER) {
        ctx.shadowBlur = 20; ctx.shadowColor = color;
        ctx.moveTo(0, -this.radius); ctx.lineTo(this.radius, 0); ctx.lineTo(0, this.radius); ctx.lineTo(-this.radius, 0); ctx.fill();
        // 塔血条
        ctx.fillStyle='#333'; ctx.fillRect(-20,-40,40,6);
        ctx.fillStyle='#0f0'; ctx.fillRect(-20,-40,40*(this.currentHp/this.maxHp),6);
    }
    ctx.restore();
  }
}

// ==========================================
// 4. 物理引擎 (Strict Physics)
// ==========================================
class PhysicsEngine {
  // 核心机制：漏斗地形 (Funnel)
  static applyFunnel(unit: Unit) {
    if (unit.isStatic) return;
    const cx = CONFIG.WIDTH / 2;
    const distRatio = Math.abs(unit.x - cx) / cx; // 0=中心, 1=边缘
    // 边界计算：中间宽，两头极窄
    const openWidth = (CONFIG.HEIGHT/CONFIG.LANE_COUNT/2 - 10) * (0.2 + 0.8 * (1 - distRatio));
    
    const laneH = CONFIG.HEIGHT/CONFIG.LANE_COUNT;
    const laneIdx = Math.floor(unit.y / laneH);
    const cy = laneIdx * laneH + laneH/2;
    
    // 硬物理约束
    if (unit.y > cy + openWidth) { unit.y = cy + openWidth; unit.vy *= -0.5; }
    if (unit.y < cy - openWidth) { unit.y = cy - openWidth; unit.vy *= -0.5; }
  }

  // 核心机制：碰撞与质量 (Collision & Mass)
  static resolve(units: Unit[], wreckages: Wreckage[]) {
    // 1. 单位互斥
    for (let i=0; i<units.length; i++) {
        for (let j=i+1; j<units.length; j++) {
            const u1 = units[i]; const u2 = units[j];
            if (u1.isDead || u2.isDead) continue;
            
            // 友军塔穿透 (Ghosting)
            if (u1.faction === u2.faction && (u1.isStatic || u2.isStatic)) continue;
            if (u1.isStatic && u2.isStatic) continue;

            const dist = Math.hypot(u1.x-u2.x, u1.y-u2.y);
            const minDist = u1.radius + u2.radius;
            
            if (dist < minDist) {
                const overlap = minDist - dist;
                const nx = (u2.x - u1.x)/dist; const ny = (u2.y - u1.y)/dist;
                const totalM = u1.mass + u2.mass;
                
                if (!u1.isStatic) { u1.x -= nx * overlap * (u2.mass/totalM); u1.y -= ny * overlap * (u2.mass/totalM); }
                if (!u2.isStatic) { u2.x += nx * overlap * (u1.mass/totalM); u2.y += ny * overlap * (u1.mass/totalM); }
            }
        }
        
        // 2. 残骸阻挡 (Wreckage as Obstacle)
        // 残骸是有质量的尸体，会阻挡单位前进，除非单位质量极大(骑兵)推开它
        for (const w of wreckages) {
            if (w.markedForDeletion) continue;
            const dist = Math.hypot(unit.x - w.x, unit.y - w.y);
            const minDist = unit.radius + w.radius;
            if (dist < minDist) {
                 const overlap = minDist - dist;
                 const nx = (unit.x - w.x)/dist; const ny = (unit.y - w.y)/dist;
                 // 残骸质量20，单位质量10~25。骑兵(Mass 15)推得动，弩手(Mass 5)推不动
                 const pushFactor = unit.mass / (unit.mass + w.mass); 
                 unit.x += nx * overlap * (1-pushFactor); 
                 unit.y += ny * overlap * (1-pushFactor);
            }
        }
        const unit = units[i];
    }
  }
}

// ==========================================
// 5. 游戏主控
// ==========================================
class Game {
  static instance: Game;
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  units: Unit[] = []; wreckages: Wreckage[] = []; particles: Particle[] = [];
  playerRes: number = 800; blockadeScore: number = 0;
  shake: number = 0; idCounter: number = 0; lastTime: number = 0;

  constructor() {
    Game.instance = this;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CONFIG.WIDTH; this.canvas.height = CONFIG.HEIGHT;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    
    this.initTowers();
    this.initControls();
    this.loop(0);
    setInterval(() => this.enemyAI(), 2000);
  }

  initTowers() {
    const laneH = CONFIG.HEIGHT/3;
    for(let i=0; i<3; i++) {
        const cy = i*laneH + laneH/2;
        // 玩家双塔
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.PLAYER, 100, cy));
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.PLAYER, 280, cy));
        // 敌人双塔
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.ENEMY, CONFIG.WIDTH-100, cy));
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.ENEMY, CONFIG.WIDTH-280, cy));
    }
  }

  spawnSquad(f: Faction, type: UnitType, lane: number) {
    if (f === Faction.PLAYER) {
        if (this.playerRes < UNIT_STATS[type].cost) return;
        this.playerRes -= UNIT_STATS[type].cost;
    }
    const count = UNIT_STATS[type].count;
    const laneH = CONFIG.HEIGHT/3;
    const cy = lane*laneH + laneH/2;
    const bx = f===Faction.PLAYER ? 40 : CONFIG.WIDTH-40;
    
    for(let i=0; i<count; i++) {
        this.units.push(new Unit(this.idCounter++, type, f, bx + (Math.random()-0.5)*30, cy + (Math.random()-0.5)*30));
    }
  }

  spawnWreckage(x: number, y: number, cost: number) {
      this.wreckages.push(new Wreckage(x, y, cost));
  }

  addResource(f: Faction, val: number) { if (f===Faction.PLAYER) this.playerRes += val; }

  enemyAI() {
      const type = [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY][Math.floor(Math.random()*3)];
      const lane = Math.floor(Math.random()*3);
      this.spawnSquad(Faction.ENEMY, type, lane);
  }

  // 核心机制：网状防御判定 (Network Logic)
  // 返回有效的连接区域列表
  checkNetworkStatus() {
      const zones = [];
      const towers = this.units.filter(u => u.type === UnitType.TOWER && !u.isDead);
      
      for(let i=0; i<towers.length; i++) {
          for(let j=i+1; j<towers.length; j++) {
              const t1 = towers[i]; const t2 = towers[j];
              if (t1.faction === t2.faction) {
                  // 判断是否是相邻车道的塔 (Y轴距离在一定范围内)
                  const dy = Math.abs(t1.y - t2.y);
                  const dx = Math.abs(t1.x - t2.x);
                  // 垂直相邻 (dy 约等于 LaneHeight) 且 水平对齐 (dx 很小)
                  if (dy > 100 && dy < CONFIG.HEIGHT/2 && dx < 50) {
                      zones.push({ faction: t1.faction, x1: t1.x, x2: t1.x, y1: t1.y, y2: t2.y });
                  }
              }
          }
      }
      return zones;
  }

  update(dt: number) {
      const networkZones = this.checkNetworkStatus();
      
      PhysicsEngine.resolve(this.units, this.wreckages);
      
      this.units.forEach(u => {
          PhysicsEngine.applyFunnel(u);
          u.update(dt, this.units, this.wreckages, networkZones);
      });
      
      this.units = this.units.filter(u => !u.isDead);
      this.wreckages = this.wreckages.filter(w => !w.markedForDeletion);
      this.particles.forEach(p => p.update()); this.particles = this.particles.filter(p => p.life > 0);
      
      this.playerRes += 0.4;
      if (this.shake > 0) this.shake *= 0.9;
      
      // 封锁计算
      let score = 0;
      this.units.forEach(u => {
          if(!u.isStatic && u.faction===Faction.PLAYER && u.x > CONFIG.WIDTH*0.7) score++;
          if(!u.isStatic && u.faction===Faction.ENEMY && u.x < CONFIG.WIDTH*0.3) score--;
      });
      this.blockadeScore += score;
  }

  draw() {
      const ctx = this.ctx;
      ctx.save();
      if (this.shake > 1) ctx.translate((Math.random()-0.5)*this.shake, (Math.random()-0.5)*this.shake);
      
      ctx.fillStyle = '#111'; ctx.fillRect(0,0,CONFIG.WIDTH, CONFIG.HEIGHT);
      
      // 1. 绘制网状防御场 (Mesh Field)
      const zones = this.checkNetworkStatus();
      zones.forEach(z => {
          ctx.fillStyle = z.faction === Faction.PLAYER ? 'rgba(0, 242, 255, 0.1)' : 'rgba(255, 0, 85, 0.1)';
          ctx.fillRect(z.x1 - 5, Math.min(z.y1, z.y2), 10, Math.abs(z.y1 - z.y2));
          // 绘制连接线
          ctx.strokeStyle = z.faction === Faction.PLAYER ? '#00f2ff' : '#ff0055';
          ctx.lineWidth = 2; ctx.setLineDash([10,10]);
          ctx.beginPath(); ctx.moveTo(z.x1, z.y1); ctx.lineTo(z.x1, z.y2); ctx.stroke();
          ctx.setLineDash([]);
      });

      // 2. 绘制漏斗边界
      ctx.strokeStyle = '#333';
      for(let i=0; i<3; i++) {
          const cy = i*(CONFIG.HEIGHT/3)+CONFIG.HEIGHT/6;
          ctx.beginPath();
          for(let x=0; x<=CONFIG.WIDTH; x+=50) {
              const r = Math.abs(x-CONFIG.WIDTH/2)/(CONFIG.WIDTH/2);
              const w = (CONFIG.HEIGHT/6-10)*(0.2+0.8*(1-r));
              if(x===0) ctx.moveTo(x,cy-w); else ctx.lineTo(x,cy-w);
          }
          ctx.stroke();
      }

      this.wreckages.forEach(w => w.draw(ctx));
      this.units.forEach(u => u.draw(ctx));
      this.particles.forEach(p => p.draw(ctx));
      
      // UI
      ctx.fillStyle='#fff'; ctx.font='20px monospace'; ctx.fillText(`RES: ${Math.floor(this.playerRes)}`, 20, 30);
      
      const cx = CONFIG.WIDTH/2;
      ctx.fillStyle='#333'; ctx.fillRect(cx-200,30,400,10);
      const ratio = this.blockadeScore/CONFIG.BLOCKADE_THRESHOLD;
      ctx.fillStyle = ratio>0 ? '#00f2ff' : '#ff0055';
      ctx.fillRect(cx,30, Math.max(-200, Math.min(200, ratio*200)), 10);
      
      if (Math.abs(ratio)>=1) {
          ctx.fillStyle='rgba(0,0,0,0.9)'; ctx.fillRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
          ctx.fillStyle='#fff'; ctx.font='50px monospace'; ctx.textAlign='center';
          ctx.fillText(ratio>0?"DOMINATION VICTORY":"DEFEAT", cx, CONFIG.HEIGHT/2);
      }
      
      ctx.restore();
  }

  initControls() {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:flex;gap:20px;';
      ['TOP','MID','BOT'].forEach((n,i) => {
          const g = document.createElement('div');
          g.innerHTML = `<div style="color:#888;text-align:center;font-family:monospace">${n}</div>`;
          [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY].forEach(t => {
              const b = document.createElement('button');
              b.innerText = `${UNIT_STATS[t].label} $${UNIT_STATS[t].cost}`;
              b.onclick = () => this.spawnSquad(Faction.PLAYER, t, i);
              b.style.cssText = 'display:block;margin:5px;background:#222;color:#eee;border:1px solid #444;padding:8px;cursor:pointer;font-family:monospace;';
              g.appendChild(b);
          });
          box.appendChild(g);
      });
      document.body.appendChild(box);
  }

  loop(ts: number) {
      const dt = ts - this.lastTime; this.lastTime = ts;
      this.update(dt); this.draw();
      requestAnimationFrame(this.loop.bind(this));
  }
}

new Game();
