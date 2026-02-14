/**
 * 《熵减战争》 (Entropy Reduction War) - Polished Edition
 * 核心升级：霓虹矢量美术、粒子系统、波次指挥机制、物理反馈
 */

// ==========================================
// 1. 全局配置与常量
// ==========================================
const CONFIG = {
  WIDTH: 1200,
  HEIGHT: 800,
  LANE_COUNT: 3,
  FPS: 60,
  BLOCKADE_THRESHOLD: 2000,
  // 视觉参数
  THEME: {
    BG: '#050510',
    GRID: 'rgba(255,255,255,0.03)',
    PLAYER: '#00f2ff', // 赛博蓝
    ENEMY: '#ff0055',  // 霓虹红
    NEUTRAL: '#ffe600' // 亮黄
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

// 兵种数据：新增 count (一次造几个) 和 shape 绘制逻辑
const UNIT_STATS = {
  [UnitType.SHIELD]:   { hp: 400,  dmg: 10, range: 45,  speed: 0.7, radius: 16, cost: 120, count: 3, mass: 20, label: '重装盾卫' },
  [UnitType.CROSSBOW]: { hp: 100,  dmg: 35, range: 200, speed: 0.9, radius: 10, cost: 150, count: 4, mass: 5,  label: '相位弩手' },
  [UnitType.CAVALRY]:  { hp: 280,  dmg: 25, range: 30,  speed: 2.5, radius: 14, cost: 200, count: 2, mass: 12, label: '突袭骑兵' },
  [UnitType.TOWER]:    { hp: 3000, dmg: 60, range: 250, speed: 0,   radius: 40, cost: 0,   count: 1, mass: 9999, label: '' }
};

// 克制矩阵
const DAMAGE_MATRIX = {
  [UnitType.SHIELD]:   { [UnitType.SHIELD]: 1.0, [UnitType.CROSSBOW]: 1.5, [UnitType.CAVALRY]: 0.5, [UnitType.TOWER]: 0.5 },
  [UnitType.CROSSBOW]: { [UnitType.SHIELD]: 0.5, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 2.0, [UnitType.TOWER]: 1.2 },
  [UnitType.CAVALRY]:  { [UnitType.SHIELD]: 2.0, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0.4 },
  [UnitType.TOWER]:    { [UnitType.SHIELD]: 0.8, [UnitType.CROSSBOW]: 1.2, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0 }
};

// ==========================================
// 2. 视觉特效系统 (Particles & VFX)
// ==========================================

class Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
  
  constructor(x: number, y: number, color: string, speed: number, size: number) {
    this.x = x; this.y = y;
    const angle = Math.random() * Math.PI * 2;
    const spd = Math.random() * speed;
    this.vx = Math.cos(angle) * spd;
    this.vy = Math.sin(angle) * spd;
    this.color = color;
    this.size = size;
    this.maxLife = 30 + Math.random() * 20;
    this.life = this.maxLife;
  }

  update() {
    this.x += this.vx; this.y += this.vy;
    this.vx *= 0.95; this.vy *= 0.95; // 摩擦力
    this.life--;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.globalAlpha = this.life / this.maxLife;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }
}

class FloatingText {
  x: number; y: number; text: string; life: number = 60; color: string;
  constructor(x: number, y: number, text: string, color: string) {
    this.x = x; this.y = y; this.text = text; this.color = color;
  }
  update() { this.y -= 0.5; this.life--; } // 向上飘动
  draw(ctx: CanvasRenderingContext2D) {
    ctx.globalAlpha = Math.max(0, this.life / 60);
    ctx.fillStyle = this.color;
    ctx.font = 'bold 14px Arial';
    ctx.fillText(this.text, this.x, this.y);
    ctx.globalAlpha = 1.0;
  }
}

// ==========================================
// 3. 游戏实体 (Entities)
// ==========================================

class Wreckage {
  x: number; y: number; value: number; radius: number = 6; 
  markedForDeletion: boolean = false;
  pulsePhase: number = 0;

  constructor(x: number, y: number, originalCost: number) {
    this.x = x; this.y = y;
    this.value = (originalCost / UNIT_STATS[UnitType.SHIELD].count) * 0.6; // 修正单体回收价值
  }

  draw(ctx: CanvasRenderingContext2D) {
    this.pulsePhase += 0.1;
    const glow = Math.sin(this.pulsePhase) * 5 + 5;
    
    ctx.save();
    ctx.shadowBlur = glow;
    ctx.shadowColor = '#fff';
    ctx.fillStyle = '#888';
    ctx.beginPath();
    // 绘制一个残缺的多边形
    ctx.moveTo(this.x - 4, this.y - 4);
    ctx.lineTo(this.x + 4, this.y + 2);
    ctx.lineTo(this.x, this.y + 5);
    ctx.fill();
    
    // 价值标识
    ctx.fillStyle = '#aff';
    ctx.font = '10px monospace';
    ctx.fillText('+', this.x+5, this.y);
    ctx.restore();
  }
}

class Unit {
  id: number; x: number; y: number;
  type: UnitType; faction: Faction;
  currentHp: number; maxHp: number; currentDmg: number;
  vx: number = 0; vy: number = 0;
  radius: number; mass: number; 
  cooldown: number = 0; isDead: boolean = false; isStatic: boolean = false;
  
  // 视觉状态
  hitFlash: number = 0; // 受击闪白帧数
  spawnAnim: number = 0; // 出生动画 (0->1)

  constructor(id: number, type: UnitType, faction: Faction, x: number, y: number) {
    this.id = id; this.type = type; this.faction = faction;
    this.x = x; this.y = y;
    
    const stats = UNIT_STATS[type];
    this.maxHp = stats.hp; this.currentHp = stats.hp;
    this.radius = stats.radius; this.mass = stats.mass;
    this.isStatic = (stats.speed === 0);
  }

  // 补给效率（熵增模拟）
  getSupplyEfficiency(): number {
    if (this.isStatic) return 1.0;
    const distBase = this.faction === Faction.PLAYER ? this.x : (CONFIG.WIDTH - this.x);
    // 使用非线性衰减，让前线更残酷
    const r = distBase / CONFIG.WIDTH; 
    return Math.max(0.3, 1 - r * 0.7); 
  }

  update(dt: number, units: Unit[], wreckages: Wreckage[]) {
    if (this.isDead) return;
    if (this.spawnAnim < 1) this.spawnAnim += 0.05;
    if (this.hitFlash > 0) this.hitFlash--;

    // 属性更新
    const efficiency = this.getSupplyEfficiency();
    this.currentDmg = UNIT_STATS[this.type].dmg * efficiency;

    // AI 逻辑
    let target: Unit | null = null;
    let minDist = Infinity;
    const range = UNIT_STATS[this.type].range;

    for (const u of units) {
      if (u.faction !== this.faction && !u.isDead) {
        const d = Math.sqrt((u.x - this.x)**2 + (u.y - this.y)**2);
        if (d < minDist) { minDist = d; target = u; }
      }
    }

    if (target && minDist <= range + target.radius) {
      // 攻击
      if (this.cooldown <= 0) {
        this.attack(target);
        this.cooldown = 60;
      } else this.cooldown--;
      
      if (!this.isStatic) { this.vx *= 0.5; this.vy *= 0.5; } // 攻击时减速
    } else {
      // 移动
      if (!this.isStatic) {
        const dir = this.faction === Faction.PLAYER ? 1 : -1;
        const spd = UNIT_STATS[this.type].speed;
        
        // 基础移动
        this.vx += dir * spd * 0.1;
        
        // 归队力 (Lane Centering)
        const laneH = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
        const laneIdx = Math.floor(this.y / laneH);
        const laneCy = laneIdx * laneH + laneH/2;
        this.vy += (laneCy - this.y) * 0.005;

        // 限制最大速度
        const currSpd = Math.sqrt(this.vx**2 + this.vy**2);
        if (currSpd > spd) {
          this.vx = (this.vx / currSpd) * spd;
          this.vy = (this.vy / currSpd) * spd;
        }

        this.x += this.vx; this.y += this.vy;
      }
    }

    // 回收逻辑
    if (!this.isStatic) {
      for (const w of wreckages) {
        if (!w.markedForDeletion) {
          if (Math.hypot(w.x - this.x, w.y - this.y) < this.radius + 10) {
            Game.instance.addResource(this.faction, w.value);
            w.markedForDeletion = true;
          }
        }
      }
    }
  }

  attack(target: Unit) {
    const mult = DAMAGE_MATRIX[this.type][target.type];
    const dmg = this.currentDmg * mult;
    
    // 视觉：发射投射物
    const color = this.faction === Faction.PLAYER ? CONFIG.THEME.PLAYER : CONFIG.THEME.ENEMY;
    
    if (this.type === UnitType.TOWER) {
      // 激光
      Game.instance.vfx.push({type: 'beam', x1:this.x, y1:this.y, x2:target.x, y2:target.y, color, life:10});
    } else if (this.type === UnitType.CROSSBOW) {
      // 箭矢 (可以用小粒子模拟飞行，这里简化为瞬间光束)
      Game.instance.vfx.push({type: 'trail', x1:this.x, y1:this.y, x2:target.x, y2:target.y, color, life:5});
    }

    target.takeDamage(dmg);
    
    // 物理：击退
    if (this.type === UnitType.CAVALRY && !target.isStatic) {
        const angle = Math.atan2(target.y - this.y, target.x - this.x);
        target.x += Math.cos(angle) * 15;
        target.y += Math.sin(angle) * 15;
    }
  }

  takeDamage(amt: number) {
    this.currentHp -= amt;
    this.hitFlash = 3; // 闪白3帧
    if (this.currentHp <= 0) {
      this.isDead = true;
      this.die();
    }
  }

  die() {
    const color = this.faction === Faction.PLAYER ? CONFIG.THEME.PLAYER : CONFIG.THEME.ENEMY;
    
    // 1. 生成残骸
    if (!this.isStatic) {
      Game.instance.spawnWreckage(this.x, this.y, UNIT_STATS[this.type].cost);
    }
    
    // 2. 爆炸粒子
    const pCount = this.isStatic ? 50 : 10;
    const pSize = this.isStatic ? 5 : 2;
    for(let i=0; i<pCount; i++) {
      Game.instance.particles.push(new Particle(this.x, this.y, color, 3, pSize));
    }

    // 3. 屏幕震动 (如果是塔)
    if (this.type === UnitType.TOWER) {
      Game.instance.shake = 20;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.x, this.y);
    // 出生动画缩放
    const scale = this.isStatic ? 1 : Math.min(1, this.spawnAnim);
    ctx.scale(scale, scale);

    // 颜色处理 (受击变白)
    let baseColor = this.faction === Faction.PLAYER ? CONFIG.THEME.PLAYER : CONFIG.THEME.ENEMY;
    if (this.hitFlash > 0) baseColor = '#ffffff';

    // 发光效果
    ctx.shadowBlur = 10;
    ctx.shadowColor = baseColor;
    ctx.strokeStyle = baseColor;
    ctx.fillStyle = baseColor;
    ctx.lineWidth = 2;

    // 绘制形状
    ctx.beginPath();
    if (this.type === UnitType.SHIELD) {
      // 盾卫：方块
      ctx.strokeRect(-this.radius, -this.radius, this.radius*2, this.radius*2);
      ctx.globalAlpha = 0.3; ctx.fillRect(-this.radius, -this.radius, this.radius*2, this.radius*2);
    } 
    else if (this.type === UnitType.CROSSBOW) {
      // 弩手：三角形
      ctx.moveTo(this.radius, 0); 
      ctx.lineTo(-this.radius, -this.radius); 
      ctx.lineTo(-this.radius, this.radius); 
      ctx.closePath();
      ctx.stroke();
    } 
    else if (this.type === UnitType.CAVALRY) {
      // 骑兵：尖锐的箭头
      ctx.moveTo(this.radius + 5, 0); 
      ctx.lineTo(-this.radius, -this.radius + 4); 
      ctx.lineTo(-this.radius + 5, 0);
      ctx.lineTo(-this.radius, this.radius - 4);
      ctx.closePath();
      ctx.fill(); // 骑兵实心
    } 
    else if (this.type === UnitType.TOWER) {
      // 塔：六边形结构
      ctx.shadowBlur = 20;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        const r = this.radius;
        ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
      ctx.closePath();
      ctx.stroke();
      // 内核
      ctx.globalAlpha = this.currentHp / this.maxHp;
      ctx.beginPath(); ctx.arc(0,0, this.radius*0.5, 0, Math.PI*2); ctx.fill();
    }

    ctx.restore();
    
    // 血条 (仅受伤时显示)
    if (this.currentHp < this.maxHp) {
        ctx.fillStyle = '#444';
        ctx.fillRect(this.x - 10, this.y - this.radius - 10, 20, 3);
        ctx.fillStyle = baseColor;
        ctx.fillRect(this.x - 10, this.y - this.radius - 10, 20 * (this.currentHp/this.maxHp), 3);
    }
  }
}

// ==========================================
// 4. 游戏主循环 (Game Core)
// ==========================================

class Game {
  static instance: Game;
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  
  units: Unit[] = [];
  wreckages: Wreckage[] = [];
  particles: Particle[] = [];
  floatingTexts: FloatingText[] = [];
  vfx: any[] = []; // 简单的瞬时特效队列

  playerRes: number = 600; enemyRes: number = 600;
  blockadeScore: number = 0;
  
  shake: number = 0; // 屏幕震动强度
  idCounter: number = 0;
  lastTime: number = 0;

  constructor() {
    Game.instance = this;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CONFIG.WIDTH; this.canvas.height = CONFIG.HEIGHT;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    
    this.initGame();
    this.createControls();
    this.loop(0);
    setInterval(() => this.enemyAI(), 2500); // 稍微降低AI频率，但AI一次也会出多兵
  }

  initGame() {
    // 初始化塔
    const laneH = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
    for (let i=0; i<3; i++) {
        const cy = i * laneH + laneH/2;
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.PLAYER, 120, cy));
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.PLAYER, 300, cy));
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.ENEMY, CONFIG.WIDTH - 120, cy));
        this.units.push(new Unit(this.idCounter++, UnitType.TOWER, Faction.ENEMY, CONFIG.WIDTH - 300, cy));
    }
  }

  spawnSquad(f: Faction, type: UnitType, lane: number) {
    const stats = UNIT_STATS[type];
    const cost = stats.cost;
    
    if (f === Faction.PLAYER) {
      if (this.playerRes < cost) return; // 资源不足
      this.playerRes -= cost;
    } else {
        // AI 资源逻辑简化
    }

    // 波次生成逻辑：生成一个小队
    const count = stats.count;
    const laneH = CONFIG.HEIGHT / CONFIG.LANE_COUNT;
    const cy = lane * laneH + laneH/2;
    const baseX = f === Faction.PLAYER ? 50 : CONFIG.WIDTH - 50;

    for (let i = 0; i < count; i++) {
        // 稍微错开位置，形成队形
        const offsetX = (Math.random() - 0.5) * 40;
        const offsetY = (Math.random() - 0.5) * 40;
        this.units.push(new Unit(this.idCounter++, type, f, baseX + offsetX, cy + offsetY));
    }
  }

  addResource(f: Faction, val: number) {
    if (f === Faction.PLAYER) {
        this.playerRes += val;
        // 浮动文字提示
        this.floatingTexts.push(new FloatingText(100, CONFIG.HEIGHT - 50, `+${Math.floor(val)}`, '#aff'));
    }
    else this.enemyRes += val;
  }

  spawnWreckage(x: number, y: number, cost: number) {
    this.wreckages.push(new Wreckage(x, y, cost));
  }

  enemyAI() {
    // AI 决策：攻击玩家最薄弱或自己兵力堆积的一路
    const laneP = Math.floor(Math.random() * 3);
    const types = [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY];
    const type = types[Math.floor(Math.random() * types.length)];
    this.spawnSquad(Faction.ENEMY, type, laneP);
  }

  update(dt: number) {
    // ==========================================
    // 1. 物理引擎修复：智能碰撞 (Smart Collision)
    // ==========================================
    for (let i=0; i<this.units.length; i++) {
        for (let j=i+1; j<this.units.length; j++) {
            const u1 = this.units[i]; const u2 = this.units[j];
            if (u1.isDead || u2.isDead) continue;
            
            // --- 修复开始：塔的穿透逻辑 ---
            // 规则1: 如果是同一阵营，且其中一个是塔，则允许穿过 (不计算碰撞)
            if (u1.faction === u2.faction) {
                if (u1.type === UnitType.TOWER || u2.type === UnitType.TOWER) continue;
            }
            // 规则2: 塔和塔之间永远不计算碰撞 (防止初始化重叠导致的弹飞)
            if (u1.isStatic && u2.isStatic) continue;
            // --- 修复结束 ---

            const dx = u2.x - u1.x; const dy = u2.y - u1.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const minDist = u1.radius + u2.radius + 2; // +2 缓冲空间
            
            if (dist < minDist && dist > 0) {
                const overlap = (minDist - dist) / 2;
                const nx = dx / dist; const ny = dy / dist;
                const totalM = u1.mass + u2.mass;
                
                // 施加推力
                if (!u1.isStatic) {
                    const f = overlap * (u2.mass / totalM); // 质量越大，推别人越狠
                    u1.x -= nx * f; u1.y -= ny * f;
                }
                if (!u2.isStatic) {
                    const f = overlap * (u1.mass / totalM);
                    u2.x += nx * f; u2.y += ny * f;
                }
            }
        }
    }

    // ==========================================
    // 2. 漏斗地形约束 (保持不变)
    // ==========================================
    this.units.forEach(u => {
        if (u.isStatic) return;
        const centerX = CONFIG.WIDTH / 2;
        const distRatio = Math.abs(u.x - centerX) / centerX;
        const funnelWidth = (CONFIG.HEIGHT/CONFIG.LANE_COUNT/2 - 15) * (0.3 + 0.7 * (1 - distRatio));
        
        const laneIdx = Math.floor(u.y / (CONFIG.HEIGHT/3));
        const laneCy = laneIdx * (CONFIG.HEIGHT/3) + (CONFIG.HEIGHT/6);
        
        // 软约束力度加强，防止穿模出界
        if (u.y > laneCy + funnelWidth) u.y -= 2;
        if (u.y < laneCy - funnelWidth) u.y += 2;
    });

    // ==========================================
    // 3. 实体循环更新
    // ==========================================
    this.units.forEach(u => u.update(dt, this.units, this.wreckages));
    this.units = this.units.filter(u => !u.isDead);
    
    this.wreckages = this.wreckages.filter(w => !w.markedForDeletion);
    
    this.particles.forEach(p => p.update());
    this.particles = this.particles.filter(p => p.life > 0);
    
    this.floatingTexts.forEach(t => t.update());
    this.floatingTexts = this.floatingTexts.filter(t => t.life > 0);

    // ==========================================
    // 4. 全局逻辑
    // ==========================================
    // 封锁分数计算
    let pDeep = 0; let eDeep = 0;
    this.units.forEach(u => {
        if(!u.isStatic) {
            if(u.faction===Faction.PLAYER && u.x > CONFIG.WIDTH*0.7) pDeep++;
            if(u.faction===Faction.ENEMY && u.x < CONFIG.WIDTH*0.3) eDeep++;
        }
    });
    if(pDeep > 5) this.blockadeScore += 5;
    if(eDeep > 5) this.blockadeScore -= 5;
    if(pDeep <= 2 && this.blockadeScore > 0) this.blockadeScore -= 2;
    if(eDeep <= 2 && this.blockadeScore < 0) this.blockadeScore += 2; // 修复了分数值回滚方向
    
    // 资源自然恢复
    this.playerRes += 0.5; 
    
    // 震动衰减
    if (this.shake > 0) this.shake *= 0.9;
    if (this.shake < 0.5) this.shake = 0;
  }
  
  draw() {
    const ctx = this.ctx;
    
    // 1. 震动应用
    ctx.save();
    if (this.shake > 0) {
        ctx.translate((Math.random()-0.5)*this.shake, (Math.random()-0.5)*this.shake);
    }

    // 2. 绘制背景 (Grid & Glow)
    ctx.fillStyle = CONFIG.THEME.BG;
    ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    
    // 绘制漏斗边界网格
    ctx.strokeStyle = CONFIG.THEME.GRID;
    ctx.lineWidth = 1;
    for(let i=0; i<3; i++) {
        const cy = i * (CONFIG.HEIGHT/3) + CONFIG.HEIGHT/6;
        ctx.beginPath();
        for(let x=0; x<=CONFIG.WIDTH; x+=20) {
            const dr = Math.abs(x - CONFIG.WIDTH/2) / (CONFIG.WIDTH/2);
            const fw = (CONFIG.HEIGHT/6 - 10) * (0.3 + 0.7 * (1 - dr));
            if(x===0) ctx.moveTo(x, cy-fw); else ctx.lineTo(x, cy-fw);
        }
        ctx.stroke();
        ctx.beginPath();
        for(let x=0; x<=CONFIG.WIDTH; x+=20) {
            const dr = Math.abs(x - CONFIG.WIDTH/2) / (CONFIG.WIDTH/2);
            const fw = (CONFIG.HEIGHT/6 - 10) * (0.3 + 0.7 * (1 - dr));
            if(x===0) ctx.moveTo(x, cy+fw); else ctx.lineTo(x, cy+fw);
        }
        ctx.stroke();
    }

    // 3. 绘制防御连线
    this.drawLinks(ctx);

    // 4. 绘制所有实体
    this.wreckages.forEach(w => w.draw(ctx));
    this.units.forEach(u => u.draw(ctx));
    this.particles.forEach(p => p.draw(ctx));
    
    // 5. 绘制特效 (Beams/Trails)
    this.vfx.forEach(v => {
        ctx.strokeStyle = v.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = v.life / 10;
        ctx.beginPath(); ctx.moveTo(v.x1, v.y1); ctx.lineTo(v.x2, v.y2); ctx.stroke();
        ctx.globalAlpha = 1;
        v.life--;
    });
    this.vfx = this.vfx.filter(v => v.life > 0);

    ctx.restore(); // 结束震动

    // 6. UI
    this.drawUI(ctx);
  }

  drawLinks(ctx: CanvasRenderingContext2D) {
      const towers = this.units.filter(u => u.type === UnitType.TOWER && !u.isDead);
      ctx.lineWidth = 2;
      for (let i=0; i<towers.length; i++) {
          for (let j=i+1; j<towers.length; j++) {
              const t1 = towers[i]; const t2 = towers[j];
              if (t1.faction === t2.faction) {
                  // 简单的距离判断连接
                  if (Math.abs(t1.x - t2.x) < 50 && Math.abs(t1.y - t2.y) < CONFIG.HEIGHT/2) {
                      const color = t1.faction === Faction.PLAYER ? CONFIG.THEME.PLAYER : CONFIG.THEME.ENEMY;
                      ctx.strokeStyle = color;
                      ctx.shadowBlur = 5; ctx.shadowColor = color;
                      ctx.globalAlpha = 0.2 + Math.random()*0.1; // 闪烁效果
                      ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.stroke();
                      ctx.globalAlpha = 1;
                      ctx.shadowBlur = 0;
                  }
              }
          }
      }
  }

  drawUI(ctx: CanvasRenderingContext2D) {
      // 资源
      ctx.fillStyle = '#fff'; ctx.font = '24px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`COMMAND POINTS: ${Math.floor(this.playerRes)}`, 20, 40);

      // 封锁进度条
      const cx = CONFIG.WIDTH/2;
      const barW = 400; const barH = 10;
      
      ctx.fillStyle = '#222';
      ctx.fillRect(cx - barW/2, 30, barW, barH);
      
      const ratio = this.blockadeScore / CONFIG.BLOCKADE_THRESHOLD;
      const w = Math.min(Math.abs(ratio), 1) * (barW/2);
      
      ctx.shadowBlur = 10;
      if (ratio > 0) {
          ctx.fillStyle = CONFIG.THEME.PLAYER; ctx.shadowColor = CONFIG.THEME.PLAYER;
          ctx.fillRect(cx, 30, w, barH);
      } else {
          ctx.fillStyle = CONFIG.THEME.ENEMY; ctx.shadowColor = CONFIG.THEME.ENEMY;
          ctx.fillRect(cx - w, 30, w, barH);
      }
      ctx.shadowBlur = 0;
      
      ctx.fillStyle = '#aaa'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
      ctx.fillText('BLOCKADE STATUS', cx, 25);

      // 浮动文字
      this.floatingTexts.forEach(t => t.draw(ctx));

      // 胜利/失败
      if (Math.abs(ratio) >= 1) {
          ctx.fillStyle = 'rgba(0,0,0,0.85)';
          ctx.fillRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
          ctx.fillStyle = ratio > 0 ? CONFIG.THEME.PLAYER : CONFIG.THEME.ENEMY;
          ctx.font = 'bold 60px monospace';
          ctx.shadowBlur = 30; ctx.shadowColor = ctx.fillStyle;
          ctx.fillText(ratio > 0 ? "SECTOR SECURED" : "CRITICAL FAILURE", cx, CONFIG.HEIGHT/2);
      }
  }

  createControls() {
    const div = document.createElement('div');
    div.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        display: flex; gap: 40px; background: rgba(0,0,0,0.8); padding: 20px;
        border: 1px solid #333; border-radius: 10px; backdrop-filter: blur(5px);
    `;
    
    ['TOP', 'MID', 'BOT'].forEach((lane, idx) => {
        const group = document.createElement('div');
        group.style.display = 'flex'; group.style.flexDirection = 'column'; group.style.gap = '10px';
        
        const label = document.createElement('div');
        label.innerText = lane; 
        label.style.color = '#888'; label.style.textAlign = 'center'; label.style.fontFamily = 'monospace';
        group.appendChild(label);
        
        [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY].forEach(t => {
            const btn = document.createElement('button');
            const stats = UNIT_STATS[t];
            // 样式优化
            btn.style.cssText = `
                background: linear-gradient(135deg, #222, #111); color: ${CONFIG.THEME.PLAYER};
                border: 1px solid #444; padding: 10px 15px; cursor: pointer;
                font-family: monospace; font-size: 12px; transition: all 0.2s;
                text-align: left;
            `;
            btn.innerHTML = `
                <span style="font-size:14px; font-weight:bold">${stats.label}</span><br>
                <span style="color:#666">$${stats.cost} x${stats.count}</span>
            `;
            
            btn.onmouseover = () => btn.style.borderColor = CONFIG.THEME.PLAYER;
            btn.onmouseout = () => btn.style.borderColor = '#444';
            btn.onmousedown = () => btn.style.background = '#333';
            btn.onmouseup = () => btn.style.background = 'linear-gradient(135deg, #222, #111)';
            
            btn.onclick = () => this.spawnSquad(Faction.PLAYER, t, idx);
            group.appendChild(btn);
        });
        div.appendChild(group);
    });
    document.body.appendChild(div);
  }

  loop(ts: number) {
    const dt = ts - this.lastTime;
    this.lastTime = ts;
    this.update(dt);
    this.draw();
    requestAnimationFrame(this.loop.bind(this));
  }
}

new Game();
