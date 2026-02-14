/**
 * 《熵减战争》 (Entropy Reduction War) MVP
 * 核心验证：物理碰撞、漏斗地形、距离衰减、资源回收、战略封锁
 */

// ==========================================
// 1. 配置 (Configuration)
// ==========================================
const CONFIG = {
  WIDTH: 1200,
  HEIGHT: 800,
  LANE_COUNT: 3,
  FPS: 60,
  // 核心机制参数
  DECAY_RATE: 0.6, // 距离衰减率：最远端只有 40% 的属性
  BLOCKADE_THRESHOLD: 1000, // 封锁胜利所需的积分
  SCAVENGE_VALUE: 0.5, // 回收残骸返还造价的比例
};

enum UnitType {
  SHIELD = '🛡️',    // 盾卫：高质量，高碰撞体积
  CROSSBOW = '🏹',  // 弩手：远程，脆皮
  CAVALRY = '🐎',   // 骑兵：高速，冲撞
}

enum Faction {
  PLAYER = 1,
  ENEMY = -1,
}

// 基础属性模板
const UNIT_STATS = {
  [UnitType.SHIELD]:   { hp: 300, dmg: 5,  range: 40,  speed: 0.8, radius: 18, cost: 50, mass: 10, color: '#3498db' },
  [UnitType.CROSSBOW]: { hp: 80,  dmg: 25, range: 180, speed: 1.0, radius: 12, cost: 60, mass: 2,  color: '#2ecc71' },
  [UnitType.CAVALRY]:  { hp: 180, dmg: 15, range: 30,  speed: 2.5, radius: 14, cost: 80, mass: 6,  color: '#e74c3c' },
};

// 克制倍率 (攻击者 -> 防御者)
const DAMAGE_MATRIX = {
  [UnitType.SHIELD]:   { [UnitType.SHIELD]: 1.0, [UnitType.CROSSBOW]: 1.5, [UnitType.CAVALRY]: 0.5 },
  [UnitType.CROSSBOW]: { [UnitType.SHIELD]: 0.5, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 2.0 },
  [UnitType.CAVALRY]:  { [UnitType.SHIELD]: 2.0, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 1.0 },
};

// ==========================================
// 2. 实体类 (Entities)
// ==========================================

// 残骸 (资源)
class Wreckage {
  x: number;
  y: number;
  value: number;
  radius: number = 8;
  markedForDeletion: boolean = false;

  constructor(x: number, y: number, originalCost: number) {
    this.x = x;
    this.y = y;
    this.value = originalCost * CONFIG.SCAVENGE_VALUE;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#7f8c8d';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '10px Arial';
    ctx.fillText('$', this.x - 3, this.y + 3);
  }
}

class Unit {
  id: number;
  x: number;
  y: number;
  type: UnitType;
  faction: Faction;
  
  // 动态属性
  currentHp: number;
  maxHp: number;
  currentDmg: number;
  
  // 物理属性
  vx: number = 0;
  vy: number = 0;
  radius: number;
  mass: number;
  
  // 状态
  cooldown: number = 0;
  isDead: boolean = false;
  cost: number;

  constructor(id: number, type: UnitType, faction: Faction, laneIndex: number) {
    this.id = id;
    this.type = type;
    this.faction = faction;
    
    const stats = UNIT_STATS[type];
    this.maxHp = stats.hp;
    this.currentHp = stats.hp;
    this.radius = stats.radius;
    this.mass = stats.mass;
    this.cost = stats.cost;
    
    // 初始位置设定 (在家门口)
    const laneHeight = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
    const laneCenter = laneIndex * laneHeight + laneHeight / 2;
    
    this.x = faction === Faction.PLAYER ? 60 : CONFIG.WIDTH - 60;
    this.y = laneCenter + (Math.random() - 0.5) * 20; // 初始微小扰动
  }

  // 核心机制：距离衰减计算
  // 返回当前的“补给效率” (0.4 ~ 1.0)
  getSupplyEfficiency(): number {
    const distFromBase = this.faction === Faction.PLAYER ? this.x : (CONFIG.WIDTH - this.x);
    const progress = distFromBase / CONFIG.WIDTH;
    // 线性衰减：在家是 100%，最远端是 (1 - DECAY_RATE)
    return Math.max(1 - CONFIG.DECAY_RATE, 1 - progress * CONFIG.DECAY_RATE);
  }

  update(dt: number, allUnits: Unit[], wreckages: Wreckage[]) {
    if (this.isDead) return;

    // 1. 应用距离衰减 (影响攻击力)
    const efficiency = this.getSupplyEfficiency();
    this.currentDmg = UNIT_STATS[this.type].dmg * efficiency;

    // 2. 索敌 (寻找射程内最近敌人)
    let target: Unit | null = null;
    let minDist = Infinity;
    
    for (const u of allUnits) {
      if (u.faction !== this.faction && !u.isDead) {
        const dx = u.x - this.x;
        const dy = u.y - this.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < minDist) {
          minDist = dist;
          target = u;
        }
      }
    }

    const stats = UNIT_STATS[this.type];
    const range = stats.range;

    // 3. 行为决策
    if (target && minDist <= range) {
      // 攻击状态
      if (this.cooldown <= 0) {
        // 应用克制倍率
        const multiplier = DAMAGE_MATRIX[this.type][target.type];
        target.takeDamage(this.currentDmg * multiplier);
        this.cooldown = 60; // 攻击间隔
        
        // 骑兵特技：冲锋击退 (物理动能体现)
        if (this.type === UnitType.CAVALRY) {
          const pushX = (target.x - this.x) / minDist * 10; // 击退 10px
          const pushY = (target.y - this.y) / minDist * 10;
          target.x += pushX;
          target.y += pushY;
        }
      } else {
        this.cooldown--;
      }
      // 攻击时减速移动
      this.vx = 0;
      this.vy = 0;
    } else {
      // 移动状态
      const dir = this.faction === Faction.PLAYER ? 1 : -1;
      this.vx = stats.speed * dir;
      // 简单的向中轴线靠拢趋势 (保持队形)
      // 获取当前车道中心
      const laneIndex = Math.floor(this.y / (CONFIG.HEIGHT / CONFIG.LANE_COUNT));
      const laneCenter = laneIndex * (CONFIG.HEIGHT / CONFIG.LANE_COUNT) + (CONFIG.HEIGHT / CONFIG.LANE_COUNT)/2;
      this.vy = (laneCenter - this.y) * 0.01; 
      
      this.x += this.vx;
      this.y += this.vy;
    }

    // 4. 回收残骸 (Value Conservation)
    for (const w of wreckages) {
      if (!w.markedForDeletion) {
        const dx = w.x - this.x;
        const dy = w.y - this.y;
        if (Math.sqrt(dx*dx + dy*dy) < this.radius + w.radius) {
          // 只有己方能回收变成钱? 或者双方都能抢? 这里设定为接触即回收
          // 只有活人能回收
          Game.instance.addResource(this.faction, w.value);
          w.markedForDeletion = true; // 标记回收
        }
      }
    }
  }

  takeDamage(amount: number) {
    this.currentHp -= amount;
    if (this.currentHp <= 0) {
      this.isDead = true;
      // 核心机制：死亡掉落残骸
      Game.instance.spawnWreckage(this.x, this.y, this.cost);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const stats = UNIT_STATS[this.type];
    
    ctx.save();
    ctx.translate(this.x, this.y);
    
    // 绘制衰减光环 (Supply Line Visual)
    const eff = this.getSupplyEfficiency();
    if (eff < 0.6) {
      ctx.strokeStyle = 'yellow';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = this.faction === Faction.PLAYER ? stats.color : '#e74c3c';
    if (this.faction === Faction.ENEMY) ctx.fillStyle = '#555'; // 敌方暗色
    ctx.strokeStyle = stats.color;
    ctx.lineWidth = 2;

    // 形状区分
    ctx.beginPath();
    if (this.type === UnitType.SHIELD) {
      ctx.rect(-this.radius, -this.radius, this.radius*2, this.radius*2);
    } else if (this.type === UnitType.CROSSBOW) {
      ctx.moveTo(this.radius, 0);
      ctx.lineTo(-this.radius, -this.radius);
      ctx.lineTo(-this.radius, this.radius);
    } else {
      ctx.arc(0, 0, this.radius, 0, Math.PI*2);
    }
    
    ctx.fill();
    if (this.faction === Faction.ENEMY) ctx.stroke();

    // 血条
    ctx.fillStyle = 'red';
    ctx.fillRect(-10, -this.radius - 8, 20, 4);
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(-10, -this.radius - 8, 20 * (this.currentHp / this.maxHp), 4);

    ctx.restore();
  }
}

// ==========================================
// 3. 物理引擎 (Physics Engine)
// ==========================================
class PhysicsEngine {
  // 核心机制：漏斗地形限制
  static applyFunnelConstraints(unit: Unit) {
    // 这是一个动态的边界函数
    // 地图中心(X=600)最宽，两头(X=0,1200)最窄
    const centerX = CONFIG.WIDTH / 2;
    const distFromCenter = Math.abs(unit.x - centerX);
    const normalizedDist = distFromCenter / centerX; // 0 (中心) -> 1 (边缘)
    
    // 漏斗因子：中心允许偏离 100%，边缘只允许 20%
    const funnelFactor = 0.2 + 0.8 * (1 - normalizedDist); 
    
    const laneHeight = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
    const laneIndex = Math.floor(unit.y / laneHeight);
    const laneCenter = laneIndex * laneHeight + laneHeight / 2;
    
    const maxSpread = (laneHeight / 2 - 10) * funnelFactor;
    
    // 强制修正 Y 轴
    if (unit.y > laneCenter + maxSpread) unit.y = laneCenter + maxSpread;
    if (unit.y < laneCenter - maxSpread) unit.y = laneCenter - maxSpread;
  }

  // 核心机制：单位间刚体碰撞 (摩擦力)
  static resolveCollisions(units: Unit[]) {
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const u1 = units[i];
        const u2 = units[j];
        if (u1.isDead || u2.isDead) continue;

        const dx = u2.x - u1.x;
        const dy = u2.y - u1.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const minDist = u1.radius + u2.radius;

        if (dist < minDist) {
          // 发生碰撞，推开彼此
          const overlap = minDist - dist;
          const force = overlap / 2; // 简单的弹性
          
          // 归一化方向
          const nx = dx / dist;
          const ny = dy / dist;

          // 质量决定谁被推开 (Shield 推不动)
          const totalMass = u1.mass + u2.mass;
          const r1 = u2.mass / totalMass; // u1 受到的推力比例
          const r2 = u1.mass / totalMass;

          u1.x -= nx * force * r1;
          u1.y -= ny * force * r1;
          u2.x += nx * force * r2;
          u2.y += ny * force * r2;
        }
      }
    }
  }
}

// ==========================================
// 4. 游戏主控 (Game Controller)
// ==========================================

class Game {
  static instance: Game;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  
  units: Unit[] = [];
  wreckages: Wreckage[] = [];
  
  playerRes: number = 300;
  enemyRes: number = 300;
  
  blockadeScore: number = 0; // 正数表示玩家优势，负数敌人优势
  
  lastTime: number = 0;
  unitCounter: number = 0;

  constructor() {
    Game.instance = this;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CONFIG.WIDTH;
    this.canvas.height = CONFIG.HEIGHT;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.initInputs();
    this.loop(0);
    
    // 敌方 AI 循环
    setInterval(() => this.enemyAI(), 1500);
  }

  addResource(faction: Faction, amount: number) {
    if (faction === Faction.PLAYER) this.playerRes += amount;
    else this.enemyRes += amount;
  }

  spawnWreckage(x: number, y: number, cost: number) {
    this.wreckages.push(new Wreckage(x, y, cost));
  }

  spawnUnit(faction: Faction, type: UnitType, lane: number) {
    const cost = UNIT_STATS[type].cost;
    if (faction === Faction.PLAYER) {
      if (this.playerRes < cost) return;
      this.playerRes -= cost;
    } else {
      // AI 无限资源测试，或者也扣费
      // if (this.enemyRes < cost) return;
      // this.enemyRes -= cost;
    }
    
    this.units.push(new Unit(this.unitCounter++, type, faction, lane));
  }

  enemyAI() {
    // 简单的 AI：哪路人少补哪路
    const laneCounts = [0, 0, 0];
    this.units.forEach(u => {
      if (u.faction === Faction.ENEMY && !u.isDead) {
        const l = Math.floor(u.y / (CONFIG.HEIGHT/3));
        if (l >= 0 && l < 3) laneCounts[l]++;
      }
    });
    
    // 找最空的一路
    let targetLane = 0;
    let minCount = Infinity;
    laneCounts.forEach((c, i) => { if (c < minCount) { minCount = c; targetLane = i; }});
    
    // 随机兵种
    const types = [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY];
    const type = types[Math.floor(Math.random() * types.length)];
    this.spawnUnit(Faction.ENEMY, type, targetLane);
  }

  // 核心机制：封锁线判定
  checkBlockade() {
    let playerInEnemyBase = 0;
    let enemyInPlayerBase = 0;

    this.units.forEach(u => {
      if (u.isDead) return;
      if (u.faction === Faction.PLAYER && u.x > CONFIG.WIDTH * 0.8) playerInEnemyBase++;
      if (u.faction === Faction.ENEMY && u.x < CONFIG.WIDTH * 0.2) enemyInPlayerBase++;
    });

    if (playerInEnemyBase > 5) this.blockadeScore += 2; // 封锁加速
    if (enemyInPlayerBase > 5) this.blockadeScore -= 2;
    
    // 自然衰减 (如果没封锁，分数会慢慢回滚)
    if (playerInEnemyBase <= 5 && this.blockadeScore > 0) this.blockadeScore--;
    if (enemyInPlayerBase <= 5 && this.blockadeScore < 0) this.blockadeScore++;
  }

  update(dt: number) {
    this.checkBlockade();
    
    // 物理碰撞
    PhysicsEngine.resolveCollisions(this.units);

    // 单位逻辑
    this.units.forEach(u => {
      u.update(dt, this.units, this.wreckages);
      PhysicsEngine.applyFunnelConstraints(u);
    });
    
    // 清理死亡
    this.units = this.units.filter(u => !u.isDead);
    this.wreckages = this.wreckages.filter(w => !w.markedForDeletion);
    
    // 自然增长资源
    this.playerRes += 0.2;
  }

  draw() {
    // 背景
    this.ctx.fillStyle = '#2c3e50';
    this.ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    
    // 绘制漏斗地形边界 (可视化)
    this.ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    const laneHeight = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
    for(let i=0; i<3; i++) {
        const cy = i * laneHeight + laneHeight/2;
        this.ctx.beginPath();
        // 模拟漏斗曲线
        for(let x=0; x<=CONFIG.WIDTH; x+=50) {
           const dist = Math.abs(x - CONFIG.WIDTH/2) / (CONFIG.WIDTH/2);
           const factor = 0.2 + 0.8 * (1 - dist);
           const spread = (laneHeight/2 - 10) * factor;
           if (x===0) this.ctx.moveTo(x, cy - spread);
           else this.ctx.lineTo(x, cy - spread);
        }
        for(let x=CONFIG.WIDTH; x>=0; x-=50) {
           const dist = Math.abs(x - CONFIG.WIDTH/2) / (CONFIG.WIDTH/2);
           const factor = 0.2 + 0.8 * (1 - dist);
           const spread = (laneHeight/2 - 10) * factor;
           this.ctx.lineTo(x, cy + spread);
        }
        this.ctx.stroke();
    }

    // 绘制残骸
    this.wreckages.forEach(w => w.draw(this.ctx));

    // 绘制单位
    this.units.forEach(u => u.draw(this.ctx));

    // UI: 封锁进度条
    this.drawUI();
  }

  drawUI() {
    const ctx = this.ctx;
    
    // 资源
    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    ctx.fillText(`资源: ${Math.floor(this.playerRes)}`, 20, 30);
    
    // 封锁条
    const barWidth = 400;
    const barHeight = 20;
    const cx = CONFIG.WIDTH / 2;
    
    ctx.fillStyle = '#333';
    ctx.fillRect(cx - barWidth/2, 40, barWidth, barHeight);
    
    const progress = this.blockadeScore / CONFIG.BLOCKADE_THRESHOLD; // -1 to 1
    const fillW = (Math.abs(progress)) * (barWidth/2);
    
    if (progress > 0) {
        ctx.fillStyle = '#3498db';
        ctx.fillRect(cx, 40, fillW, barHeight);
    } else {
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(cx - fillW, 40, fillW, barHeight);
    }
    
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.fillText("战略封锁线", cx, 35);
    ctx.font = '12px Arial';
    ctx.fillText("把兵线推到对方底线以推进进度", cx, 75);
    
    // 游戏结束判定
    if (Math.abs(this.blockadeScore) >= CONFIG.BLOCKADE_THRESHOLD) {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
        ctx.fillStyle = progress > 0 ? '#3498db' : '#e74c3c';
        ctx.font = '50px Arial';
        ctx.fillText(progress > 0 ? "VICTORY" : "DEFEAT", cx, CONFIG.HEIGHT/2);
    }
  }

  initInputs() {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.display = 'flex';
    container.style.gap = '20px';
    
    ['上路', '中路', '下路'].forEach((laneName, idx) => {
        const group = document.createElement('div');
        group.style.display = 'flex';
        group.style.flexDirection = 'column';
        group.style.gap = '5px';
        
        const label = document.createElement('div');
        label.innerText = laneName;
        label.style.color = 'white';
        label.style.textAlign = 'center';
        group.appendChild(label);
        
        [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY].forEach(type => {
            const btn = document.createElement('button');
            const stats = UNIT_STATS[type];
            btn.innerText = `${type} $${stats.cost}`;
            btn.style.padding = '10px';
            btn.style.cursor = 'pointer';
            btn.onclick = () => this.spawnUnit(Faction.PLAYER, type, idx);
            group.appendChild(btn);
        });
        container.appendChild(group);
    });
    
    document.body.appendChild(container);
  }

  loop(timestamp: number) {
    const dt = timestamp - this.lastTime;
    this.lastTime = timestamp;
    
    this.update(dt);
    this.draw();
    
    requestAnimationFrame(this.loop.bind(this));
  }
}

new Game();
