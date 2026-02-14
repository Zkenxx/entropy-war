/**
 * 《熵减战争》 (Entropy Reduction War) Ver 0.2
 * 新增特性：防御塔系统、防御阵列连线、攻城战逻辑
 */

// ==========================================
// 1. 配置 (Configuration)
// ==========================================
const CONFIG = {
  WIDTH: 1200,
  HEIGHT: 800,
  LANE_COUNT: 3,
  FPS: 60,
  DECAY_RATE: 0.5,     // 距离衰减率
  BLOCKADE_THRESHOLD: 1500,
  SCAVENGE_VALUE: 0.6, // 回收率
};

enum UnitType {
  SHIELD = '🛡️',    
  CROSSBOW = '🏹',  
  CAVALRY = '🐎',   
  TOWER = '🏯',     // 新增：防御塔
}

enum Faction {
  PLAYER = 1,
  ENEMY = -1,
}

// 基础属性模板
const UNIT_STATS = {
  // 兵种
  [UnitType.SHIELD]:   { hp: 350,  dmg: 8,   range: 40,  speed: 0.8, radius: 18, cost: 50, mass: 10,  color: '#3498db' },
  [UnitType.CROSSBOW]: { hp: 80,   dmg: 30,  range: 180, speed: 1.0, radius: 12, cost: 60, mass: 2,   color: '#2ecc71' },
  [UnitType.CAVALRY]:  { hp: 200,  dmg: 18,  range: 30,  speed: 2.8, radius: 14, cost: 80, mass: 8,   color: '#e74c3c' },
  // 建筑 (静态单位)
  [UnitType.TOWER]:    { hp: 2500, dmg: 40,  range: 220, speed: 0,   radius: 35, cost: 0,  mass: 9999, color: '#f1c40f' },
};

// 克制倍率
const DAMAGE_MATRIX = {
  [UnitType.SHIELD]:   { [UnitType.SHIELD]: 1.0, [UnitType.CROSSBOW]: 1.5, [UnitType.CAVALRY]: 0.5, [UnitType.TOWER]: 0.5 },
  [UnitType.CROSSBOW]: { [UnitType.SHIELD]: 0.5, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 2.0, [UnitType.TOWER]: 1.2 }, // 弩手拆塔稍快
  [UnitType.CAVALRY]:  { [UnitType.SHIELD]: 2.0, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0.4 }, // 骑兵拆塔慢
  [UnitType.TOWER]:    { [UnitType.SHIELD]: 0.8, [UnitType.CROSSBOW]: 1.5, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0 },
};

// ==========================================
// 2. 实体类 (Entities)
// ==========================================

class Wreckage {
  x: number; y: number; value: number; radius: number = 8; markedForDeletion: boolean = false;
  constructor(x: number, y: number, originalCost: number) {
    this.x = x; this.y = y; this.value = originalCost * CONFIG.SCAVENGE_VALUE;
  }
  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#7f8c8d';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '10px Arial'; ctx.fillText('+', this.x-3, this.y+3);
  }
}

class Unit {
  id: number;
  x: number; y: number;
  type: UnitType; faction: Faction;
  currentHp: number; maxHp: number; currentDmg: number;
  vx: number = 0; vy: number = 0;
  radius: number; mass: number; cost: number;
  cooldown: number = 0; isDead: boolean = false;
  isStatic: boolean = false; // 是否是建筑

  constructor(id: number, type: UnitType, faction: Faction, x: number, y: number) {
    this.id = id; this.type = type; this.faction = faction;
    this.x = x; this.y = y;
    
    const stats = UNIT_STATS[type];
    this.maxHp = stats.hp; this.currentHp = stats.hp;
    this.radius = stats.radius; this.mass = stats.mass; this.cost = stats.cost;
    this.isStatic = (stats.speed === 0);
  }

  getSupplyEfficiency(): number {
    if (this.isStatic) return 1.0; // 塔不受补给衰减影响
    const distFromBase = this.faction === Faction.PLAYER ? this.x : (CONFIG.WIDTH - this.x);
    const progress = distFromBase / CONFIG.WIDTH;
    return Math.max(1 - CONFIG.DECAY_RATE, 1 - progress * CONFIG.DECAY_RATE);
  }

  update(dt: number, allUnits: Unit[], wreckages: Wreckage[]) {
    if (this.isDead) return;

    // 1. 属性计算
    const efficiency = this.getSupplyEfficiency();
    this.currentDmg = UNIT_STATS[this.type].dmg * efficiency;

    // 2. 索敌 (塔优先攻击最近单位)
    let target: Unit | null = null;
    let minDist = Infinity;
    const stats = UNIT_STATS[this.type];
    
    for (const u of allUnits) {
      if (u.faction !== this.faction && !u.isDead) {
        const dist = Math.sqrt((u.x - this.x)**2 + (u.y - this.y)**2);
        if (dist < minDist) {
          minDist = dist;
          target = u;
        }
      }
    }

    // 3. 战斗逻辑
    if (target && minDist <= stats.range) {
      if (this.cooldown <= 0) {
        // 塔发射激光效果
        if (this.type === UnitType.TOWER) {
            Game.instance.effects.push({
                x1: this.x, y1: this.y, x2: target.x, y2: target.y, life: 10, color: this.faction === Faction.PLAYER ? '#f1c40f' : '#e74c3c'
            });
        }
        
        const multiplier = DAMAGE_MATRIX[this.type][target.type] || 1.0;
        target.takeDamage(this.currentDmg * multiplier);
        this.cooldown = 60; // 攻击间隔 1秒
        
        if (this.type === UnitType.CAVALRY && !target.isStatic) {
          // 骑兵击退，但推不动塔
          const push = 10;
          target.x += (target.x - this.x) / minDist * push;
          target.y += (target.y - this.y) / minDist * push;
        }
      } else {
        this.cooldown--;
      }
      if (!this.isStatic) { this.vx = 0; this.vy = 0; }
    } else {
      // 移动逻辑
      if (!this.isStatic) {
        const dir = this.faction === Faction.PLAYER ? 1 : -1;
        this.vx = stats.speed * dir;
        
        // 归队逻辑
        const laneH = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
        const laneIdx = Math.floor(this.y / laneH);
        const laneCy = laneIdx * laneH + laneH/2;
        this.vy = (laneCy - this.y) * 0.02;

        this.x += this.vx;
        this.y += this.vy;
      }
    }

    // 4. 回收资源
    if (!this.isStatic) {
        for (const w of wreckages) {
            if (!w.markedForDeletion) {
                if (Math.sqrt((w.x - this.x)**2 + (w.y - this.y)**2) < this.radius + w.radius) {
                    Game.instance.addResource(this.faction, w.value);
                    w.markedForDeletion = true;
                }
            }
        }
    }
  }

  takeDamage(amount: number) {
    this.currentHp -= amount;
    if (this.currentHp <= 0) {
      this.isDead = true;
      if (!this.isStatic) Game.instance.spawnWreckage(this.x, this.y, this.cost);
      // 塔倒塌效果
      if (this.type === UnitType.TOWER) {
          // 可以在这里添加爆炸特效
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const stats = UNIT_STATS[this.type];
    ctx.save();
    ctx.translate(this.x, this.y);
    
    // 阵营颜色
    let color = this.faction === Faction.PLAYER ? stats.color : '#e74c3c';
    if (this.faction === Faction.ENEMY) {
        if (this.type === UnitType.TOWER) color = '#c0392b'; // 敌方塔深红
        else color = '#7f8c8d'; // 敌方兵灰色
    } 

    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;

    // 绘制形状
    ctx.beginPath();
    if (this.type === UnitType.TOWER) {
        // 塔：大方块 + 核心
        ctx.fillRect(-this.radius, -this.radius, this.radius*2, this.radius*2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(-this.radius+5, -this.radius+5, this.radius*2-10, this.radius*2-10);
        // 塔血条画在头顶
        ctx.fillStyle = 'red'; ctx.fillRect(-20, -45, 40, 6);
        ctx.fillStyle = '#0f0'; ctx.fillRect(-20, -45, 40 * (this.currentHp/this.maxHp), 6);
    } else {
        // 普通单位
        if (this.type === UnitType.SHIELD) ctx.rect(-this.radius, -this.radius, this.radius*2, this.radius*2);
        else if (this.type === UnitType.CROSSBOW) {
            ctx.moveTo(this.radius, 0); ctx.lineTo(-this.radius, -this.radius); ctx.lineTo(-this.radius, this.radius);
        } else ctx.arc(0, 0, this.radius, 0, Math.PI*2);
        
        ctx.fill();
        if (this.faction === Faction.ENEMY) ctx.stroke();
        
        // 普通单位血条
        ctx.fillStyle = 'red'; ctx.fillRect(-10, -this.radius - 8, 20, 4);
        ctx.fillStyle = '#2ecc71'; ctx.fillRect(-10, -this.radius - 8, 20 * (this.currentHp / this.maxHp), 4);
        
        // 补给光环
        if (this.getSupplyEfficiency() < 0.6) {
             ctx.strokeStyle = 'yellow'; ctx.setLineDash([2,2]); 
             ctx.beginPath(); ctx.arc(0,0, this.radius+4, 0, Math.PI*2); ctx.stroke();
        }
    }
    ctx.restore();
  }
}

// ==========================================
// 3. 物理引擎 (Physics)
// ==========================================
class PhysicsEngine {
  static applyFunnel(unit: Unit) {
    if (unit.isStatic) return; // 塔不移动
    const centerX = CONFIG.WIDTH / 2;
    const distFactor = 1 - Math.abs(unit.x - centerX) / centerX; // 0=边缘, 1=中心
    const funnelOpen = 0.2 + 0.8 * distFactor; 
    
    const laneH = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
    const laneIdx = Math.floor(unit.y / laneH);
    const laneCy = laneIdx * laneH + laneH/2;
    const maxSpread = (laneH/2 - 15) * funnelOpen;
    
    if (unit.y > laneCy + maxSpread) unit.y = laneCy + maxSpread;
    if (unit.y < laneCy - maxSpread) unit.y = laneCy - maxSpread;
  }

  static resolveCollisions(units: Unit[]) {
    for (let i=0; i<units.length; i++) {
      for (let j=i+1; j<units.length; j++) {
        const u1 = units[i]; const u2 = units[j];
        if (u1.isDead || u2.isDead) continue;
        
        const dx = u2.x - u1.x; const dy = u2.y - u1.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const minDist = u1.radius + u2.radius;
        
        if (dist < minDist) {
           const overlap = minDist - dist;
           const nx = dx/dist; const ny = dy/dist;
           
           // 处理无限质量 (塔)
           if (u1.isStatic && u2.isStatic) continue;
           if (u1.isStatic) {
               u2.x += nx * overlap; u2.y += ny * overlap;
           } else if (u2.isStatic) {
               u1.x -= nx * overlap; u1.y -= ny * overlap;
           } else {
               const totalM = u1.mass + u2.mass;
               u1.x -= nx * overlap * (u2.mass/totalM); u1.y -= ny * overlap * (u2.mass/totalM);
               u2.x += nx * overlap * (u1.mass/totalM); u2.y += ny * overlap * (u1.mass/totalM);
           }
        }
      }
    }
  }
}

// ==========================================
// 4. 游戏主控 (Game Core)
// ==========================================
class Game {
  static instance: Game;
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  units: Unit[] = []; wreckages: Wreckage[] = []; effects: any[] = [];
  playerRes: number = 400; enemyRes: number = 400;
  blockadeScore: number = 0;
  lastTime: number = 0; idCounter: number = 0;

  constructor() {
    Game.instance = this;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CONFIG.WIDTH; this.canvas.height = CONFIG.HEIGHT;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.initTowers();
    this.initUI();
    this.loop(0);
    setInterval(() => this.enemyAI(), 2000);
  }

  initTowers() {
    const laneH = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
    for (let i=0; i<3; i++) {
        const cy = i * laneH + laneH/2;
        // 玩家塔 (左侧) - 两个层级
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.PLAYER, 150, cy)); // 二塔
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.PLAYER, 350, cy)); // 一塔 (前线)
        
        // 敌人塔 (右侧)
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.ENEMY, CONFIG.WIDTH - 150, cy));
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.ENEMY, CONFIG.WIDTH - 350, cy));
    }
  }

  addResource(faction: Faction, val: number) {
    if (faction === Faction.PLAYER) this.playerRes += val;
    else this.enemyRes += val;
  }

  spawnWreckage(x: number, y: number, cost: number) {
    this.wreckages.push(new Wreckage(x, y, cost));
  }

  spawnUnit(f: Faction, type: UnitType, lane: number) {
    const cost = UNIT_STATS[type].cost;
    if (f === Faction.PLAYER) {
        if (this.playerRes < cost) return;
        this.playerRes -= cost;
    }
    const laneH = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
    const cy = lane * laneH + laneH/2;
    // 稍微随机化出生点Y，防止叠在一起
    const spawnY = cy + (Math.random()-0.5)*10;
    const spawnX = f === Faction.PLAYER ? 50 : CONFIG.WIDTH - 50;
    
    this.units.push(new Unit(this.idCounter++, type, f, spawnX, spawnY));
  }

  enemyAI() {
    // 简单AI：检测哪一路玩家兵多，就在那一路出兵
    const lanePressure = [0, 0, 0];
    this.units.forEach(u => {
        if (u.faction === Faction.PLAYER && !u.isStatic) {
            const l = Math.floor(u.y / (CONFIG.HEIGHT/3));
            if(l>=0 && l<3) lanePressure[l]++;
        }
    });
    // 找压力最大的路，或者随机
    let target = 0;
    if (Math.random() > 0.3) {
        let max = -1;
        lanePressure.forEach((p, i) => { if (p > max) { max = p; target = i; } });
    } else {
        target = Math.floor(Math.random()*3);
    }
    
    const types = [UnitType.SHIELD, UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY];
    const type = types[Math.floor(Math.random()*types.length)];
    this.spawnUnit(Faction.ENEMY, type, target);
  }

  drawNetwork(ctx: CanvasRenderingContext2D) {
    // 绘制“网状防御”连线
    // 寻找相邻车道的同阵营塔
    const towers = this.units.filter(u => u.type === UnitType.TOWER && !u.isDead);
    
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    
    for (let i=0; i<towers.length; i++) {
        for (let j=i+1; j<towers.length; j++) {
            const t1 = towers[i]; const t2 = towers[j];
            if (t1.faction === t2.faction) {
                // 只有垂直相邻的塔才连线 (判断X坐标相近且Y坐标相邻)
                if (Math.abs(t1.x - t2.x) < 20 && Math.abs(t1.y - t2.y) < (CONFIG.HEIGHT/3 + 50)) {
                    ctx.strokeStyle = t1.faction === Faction.PLAYER ? 'rgba(52, 152, 219, 0.3)' : 'rgba(231, 76, 60, 0.3)';
                    ctx.beginPath();
                    ctx.moveTo(t1.x, t1.y);
                    ctx.lineTo(t2.x, t2.y);
                    ctx.stroke();
                }
            }
        }
    }
    ctx.setLineDash([]);
  }

  update(dt: number) {
    PhysicsEngine.resolveCollisions(this.units);
    
    this.units.forEach(u => {
        PhysicsEngine.applyFunnel(u);
        u.update(dt, this.units, this.wreckages);
    });
    this.units = this.units.filter(u => !u.isDead);
    this.wreckages = this.wreckages.filter(w => !w.markedForDeletion);
    
    // 封锁计算
    let pInE = 0; let eInP = 0;
    this.units.forEach(u => {
        if(!u.isStatic && u.faction===Faction.PLAYER && u.x > CONFIG.WIDTH*0.75) pInE++;
        if(!u.isStatic && u.faction===Faction.ENEMY && u.x < CONFIG.WIDTH*0.25) eInP++;
    });
    if (pInE > 3) this.blockadeScore += 3;
    if (eInP > 3) this.blockadeScore -= 3;
    if (pInE<=3 && this.blockadeScore>0) this.blockadeScore--;
    if (eInP<=3 && this.blockadeScore<0) this.blockadeScore++;
    
    // 资源自然增长
    this.playerRes += 0.3;
  }

  draw() {
    this.ctx.fillStyle = '#2c3e50'; this.ctx.fillRect(0,0,CONFIG.WIDTH, CONFIG.HEIGHT);
    
    // 画地形线
    this.ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for(let i=0; i<3; i++) {
        let y = i * (CONFIG.HEIGHT/3) + CONFIG.HEIGHT/6;
        this.ctx.beginPath(); this.ctx.moveTo(0,y); this.ctx.lineTo(CONFIG.WIDTH, y); this.ctx.stroke();
    }

    this.drawNetwork(this.ctx);
    this.wreckages.forEach(w => w.draw(this.ctx));
    this.units.forEach(u => u.draw(this.ctx));
    
    // 绘制特效 (激光)
    this.effects = this.effects.filter(e => e.life > 0);
    this.effects.forEach(e => {
        this.ctx.strokeStyle = e.color; this.ctx.lineWidth = 2;
        this.ctx.beginPath(); this.ctx.moveTo(e.x1, e.y1); this.ctx.lineTo(e.x2, e.y2); this.ctx.stroke();
        e.life--;
    });

    this.drawUI();
  }

  drawUI() {
    const ctx = this.ctx;
    ctx.fillStyle = 'white'; ctx.font = '20px Arial';
    ctx.fillText(`资源: ${Math.floor(this.playerRes)}`, 20, 30);
    
    // 封锁条
    const cx = CONFIG.WIDTH/2;
    ctx.fillStyle = '#333'; ctx.fillRect(cx-200, 30, 400, 20);
    const pct = Math.min(1, Math.abs(this.blockadeScore)/CONFIG.BLOCKADE_THRESHOLD);
    ctx.fillStyle = this.blockadeScore > 0 ? '#3498db' : '#e74c3c';
    if(this.blockadeScore > 0) ctx.fillRect(cx, 30, 200*pct, 20);
    else ctx.fillRect(cx - 200*pct, 30, 200*pct, 20);
    
    if(pct >= 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(0,0,CONFIG.WIDTH, CONFIG.HEIGHT);
        ctx.fillStyle = '#fff'; ctx.font = '60px Arial'; ctx.textAlign = 'center';
        ctx.fillText(this.blockadeScore>0?"VICTORY":"DEFEAT", cx, CONFIG.HEIGHT/2);
    }
  }

  initUI() {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); display:flex; gap:20px;';
    ['Top', 'Mid', 'Bot'].forEach((name, i) => {
        const col = document.createElement('div');
        col.innerHTML = `<div style="color:#fff;text-align:center">${name}</div>`;
        [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY].forEach(t => {
            const b = document.createElement('button');
            b.innerText = `${t} ${UNIT_STATS[t].cost}`;
            b.onclick = () => this.spawnUnit(Faction.PLAYER, t, i);
            col.appendChild(b);
        });
        box.appendChild(col);
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
