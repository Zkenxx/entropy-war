/**
 * 《熵减战争》 (Entropy Reduction War) - Tactical Balance Patch
 * 核心调整：经济紧缩、节奏降速、AI波次集结、塔积缩小
 */

// ==========================================
// 1. 核心数值配置 (Balance Config)
// ==========================================
const CONFIG = {
  WIDTH: 1200,
  HEIGHT: 800,
  FPS: 60,
  
  // 经济系统：紧缩
  STARTING_RES: 250,      // 初始资源大幅减少 (原800)
  PASSIVE_INCOME: 0.1,    // 自然增长极慢 (原0.5)，强迫玩家回收残骸
  WRECKAGE_VALUE: 0.7,    // 残骸回收率高，鼓励进攻

  // 节奏控制
  GAME_SPEED_MOD: 0.8,    // 全局速度修正
  DECAY_RATE: 0.6,        // 远征衰减
  
  // 胜利条件
  BLOCKADE_THRESHOLD: 4000, // 需要更长时间的压制才能赢
};

enum UnitType { SHIELD='🛡️', CROSSBOW='🏹', CAVALRY='🐎', TOWER='🏯' }
enum Faction { PLAYER=1, ENEMY=-1 }
enum Lane { TOP=0, MID=1, BOT=2 }

// 单位数值重构：高血量，低速度，强调职能
const UNIT_STATS = {
  [UnitType.SHIELD]:   { 
      hp: 600, dmg: 12, range: 45, speed: 0.5, radius: 16, // 慢速坦克
      cost: 100, count: 3, mass: 40, color:'#3498db', label: '重装盾卫' 
  },
  [UnitType.CROSSBOW]: { 
      hp: 120, dmg: 35, range: 180, speed: 0.8, radius: 10, // 脆皮输出，射程削弱以防风筝
      cost: 140, count: 3, mass: 5,  color:'#2ecc71', label: '狙击弩手' 
  },
  [UnitType.CAVALRY]:  { 
      hp: 350, dmg: 20, range: 35, speed: 1.8, radius: 14, // 突进破阵
      cost: 220, count: 2, mass: 25, color:'#e74c3c', label: '重骑兵' 
  },
  [UnitType.TOWER]:    { 
      hp: 4000, dmg: 50, range: 220, speed: 0, radius: 25, // 塔缩小(40->25)，伤害降低
      cost: 0, count: 1, mass: 9999, color:'#f1c40f', label: '' 
  }
};

const DAMAGE_MATRIX = {
  [UnitType.SHIELD]:   { [UnitType.SHIELD]: 1.0, [UnitType.CROSSBOW]: 1.5, [UnitType.CAVALRY]: 0.5, [UnitType.TOWER]: 0.4 },
  [UnitType.CROSSBOW]: { [UnitType.SHIELD]: 0.5, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 2.0, [UnitType.TOWER]: 0.8 },
  [UnitType.CAVALRY]:  { [UnitType.SHIELD]: 2.0, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0.5 },
  [UnitType.TOWER]:    { [UnitType.SHIELD]: 1.0, [UnitType.CROSSBOW]: 1.2, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0 }
};

// ==========================================
// 2. 地图几何 (Eye-Shape Map)
// ==========================================
class MapUtils {
  static getLaneY(lane: Lane, x: number): number {
    const cy = CONFIG.HEIGHT / 2;
    if (lane === Lane.MID) return cy;
    // 稍微减小弯曲度，让战场更紧凑
    const curve = Math.sin((x / CONFIG.WIDTH) * Math.PI) * 220;
    return lane === Lane.TOP ? cy - curve : cy + curve;
  }
  
  static getLaneTangent(lane: Lane, x: number, dir: number) {
      if (lane === Lane.MID) return {x: dir, y: 0};
      const y1 = MapUtils.getLaneY(lane, x);
      const y2 = MapUtils.getLaneY(lane, x + 10*dir);
      const angle = Math.atan2(y2-y1, 10*dir);
      return {x: Math.cos(angle), y: Math.sin(angle)};
  }
}

// ==========================================
// 3. 游戏实体 (Entities)
// ==========================================

class Particle {
    x: number; y: number; vx: number; vy: number; life: number; color: string;
    constructor(x:number, y:number, c:string) {
        this.x=x; this.y=y; this.color=c; this.life=1.0;
        const a = Math.random()*Math.PI*2; const s = Math.random()*2;
        this.vx=Math.cos(a)*s; this.vy=Math.sin(a)*s;
    }
    update() { this.x+=this.vx; this.y+=this.vy; this.life-=0.05; }
    draw(ctx:CanvasRenderingContext2D) {
        ctx.globalAlpha=this.life; ctx.fillStyle=this.color; 
        ctx.beginPath(); ctx.arc(this.x,this.y,2,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
    }
}

class Wreckage {
  x: number; y: number; value: number; radius: number = 8; marked: boolean = false; mass: number = 20;
  constructor(x: number, y: number, cost: number) { this.x=x; this.y=y; this.value = cost * CONFIG.WRECKAGE_VALUE; }
  draw(ctx: CanvasRenderingContext2D) {
    // 视觉优化：闪烁的残骸
    const flash = Math.abs(Math.sin(Date.now()/300));
    ctx.fillStyle = `rgba(100,100,100,${0.5+flash*0.3})`;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth=1; ctx.stroke();
    // 显示价值
    ctx.fillStyle = '#0ff'; ctx.font='10px monospace'; ctx.textAlign='center';
    ctx.fillText(`+${Math.floor(this.value)}`, this.x, this.y-10);
  }
}

class Unit {
  id: number; x: number; y: number; lane: Lane;
  type: UnitType; faction: Faction;
  hp: number; maxHp: number; dmg: number;
  vx: number = 0; vy: number = 0;
  radius: number; mass: number; 
  cooldown: number = 0; dead: boolean = false; static: boolean = false;
  
  hitFlash: number = 0; // 受击反馈

  constructor(id: number, type: UnitType, faction: Faction, lane: Lane, x: number) {
    this.id = id; this.type = type; this.faction = faction; this.lane = lane;
    this.x = x; this.y = MapUtils.getLaneY(lane, x) + (Math.random()-0.5)*20; // 稍微分散
    
    const s = UNIT_STATS[type];
    this.maxHp = s.hp; this.hp = s.hp; this.radius = s.radius; this.mass = s.mass;
    this.static = (s.speed === 0);
  }

  update(units: Unit[], wrecks: Wreckage[]) {
    if(this.dead) return;
    if(this.hitFlash>0) this.hitFlash--;

    // 1. 距离衰减 (Entropy)
    let entropy = 1.0;
    if (!this.static) {
        const dist = this.faction===Faction.PLAYER ? this.x : (CONFIG.WIDTH-this.x);
        entropy = Math.max(0.4, 1 - (dist/CONFIG.WIDTH)*CONFIG.DECAY_RATE);
    }
    this.dmg = UNIT_STATS[this.type].dmg * entropy;

    // 2. 索敌 (Targeting)
    let target = null; let minDist = Infinity;
    const range = UNIT_STATS[this.type].range;
    for(const u of units) {
        if(u.faction !== this.faction && !u.dead) {
            const d = Math.hypot(u.x-this.x, u.y-this.y);
            if(d < minDist) { minDist = d; target = u; }
        }
    }

    // 3. 状态机
    if(target && minDist <= range + target.radius) {
        // 攻击
        if(this.cooldown<=0) {
            const mult = DAMAGE_MATRIX[this.type][target.type];
            target.takeDamage(this.dmg * mult);
            this.cooldown = 60; // 1秒攻击一次 (慢节奏)
            
            // 攻击特效
            Game.inst.fx.push({x1:this.x, y1:this.y, x2:target.x, y2:target.y, life:5, color: this.faction===Faction.PLAYER?'#0ff':'#f05'});
        } else this.cooldown--;
        
        // 攻击时大幅减速
        if(!this.static) { this.vx *= 0.1; this.vy *= 0.1; }

    } else {
        // 移动 (Movement)
        if(!this.static) {
            const baseSpd = UNIT_STATS[this.type].speed * CONFIG.GAME_SPEED_MOD;
            const dir = this.faction === Faction.PLAYER ? 1 : -1;
            
            // 沿兵线切线移动
            const tan = MapUtils.getLaneTangent(this.lane, this.x, dir);
            
            // 基础推进力
            this.vx += tan.x * baseSpd * 0.1;
            this.vy += tan.y * baseSpd * 0.1;

            // 强力归队 (防止飞出地图)
            const idealY = MapUtils.getLaneY(this.lane, this.x);
            this.vy += (idealY - this.y) * 0.05;

            // 速度钳制
            const s = Math.hypot(this.vx, this.vy);
            if(s > baseSpd) { this.vx=(this.vx/s)*baseSpd; this.vy=(this.vy/s)*baseSpd; }
            
            this.x += this.vx; this.y += this.vy;
        }
    }

    // 4. 残骸回收
    if(!this.static) {
        for(const w of wrecks) {
            if(!w.marked && Math.hypot(w.x-this.x, w.y-this.y) < this.radius+w.radius) {
                Game.inst.addRes(this.faction, w.value); w.marked=true;
                // 回收特效文字
                Game.inst.texts.push({x:this.x, y:this.y-20, txt:`+$${Math.floor(w.value)}`, life:40, color:'#0ff'});
            }
        }
    }
  }

  takeDamage(n: number) {
      this.hp -= n; 
      this.hitFlash = 5;
      if(this.hp<=0) {
          this.dead = true;
          // 死亡生成残骸
          if(!this.static) Game.inst.wrecks.push(new Wreckage(this.x, this.y, UNIT_STATS[this.type].cost));
          // 死亡粒子
          for(let i=0; i<5; i++) Game.inst.particles.push(new Particle(this.x, this.y, UNIT_STATS[this.type].color));
          if(this.type === UnitType.TOWER) Game.inst.shake = 15;
      }
  }

  draw(ctx: CanvasRenderingContext2D) {
      ctx.save(); ctx.translate(this.x, this.y);
      
      const isPlayer = this.faction === Faction.PLAYER;
      let color = UNIT_STATS[this.type].color;
      if(!isPlayer) color = this.type===UnitType.TOWER ? '#c0392b' : '#aaa'; // 敌人单位去色，强调塔
      if(this.hitFlash>0) color = '#fff';

      ctx.fillStyle = color; ctx.strokeStyle = color;
      
      // 绘制逻辑
      if(this.type === UnitType.TOWER) {
          ctx.beginPath(); 
          // 塔变成六边形
          for(let i=0; i<6; i++) {
              const a = i*Math.PI/3;
              ctx.lineTo(Math.cos(a)*this.radius, Math.sin(a)*this.radius);
          }
          ctx.fill();
          // 血条
          ctx.fillStyle='#333'; ctx.fillRect(-15,-35,30,5);
          ctx.fillStyle='#0f0'; ctx.fillRect(-15,-35,30*(this.hp/this.maxHp),5);
      } else {
          // 单位
          ctx.beginPath();
          if(this.type===UnitType.SHIELD) ctx.fillRect(-this.radius,-this.radius,this.radius*2,this.radius*2);
          else if(this.type===UnitType.CROSSBOW) { ctx.moveTo(this.radius,0); ctx.lineTo(-this.radius,-this.radius); ctx.lineTo(-this.radius,this.radius); ctx.fill(); }
          else ctx.arc(0,0,this.radius,0,Math.PI*2); ctx.fill();
          
          if(!isPlayer) { ctx.lineWidth=2; ctx.stroke(); }
      }
      ctx.restore();
  }
}

// ==========================================
// 4. 物理与AI (Physics & AI)
// ==========================================
class Physics {
    static resolve(units: Unit[], wrecks: Wreckage[]) {
        for(let i=0; i<units.length; i++) {
            for(let j=i+1; j<units.length; j++) {
                const u1=units[i]; const u2=units[j];
                if(u1.dead || u2.dead) continue;
                // 友军穿透塔 (Ghosting)
                if(u1.faction === u2.faction && (u1.static || u2.static)) continue;
                if(u1.static && u2.static) continue;

                const d = Math.hypot(u1.x-u2.x, u1.y-u2.y);
                const min = u1.radius + u2.radius;
                
                if(d < min) {
                    const pen = (min-d)/2;
                    const nx = (u2.x-u1.x)/d; const ny = (u2.y-u1.y)/d;
                    const tm = u1.mass+u2.mass;
                    
                    if(!u1.static) { u1.x-=nx*pen*(u2.mass/tm); u1.y-=ny*pen*(u2.mass/tm); }
                    if(!u2.static) { u2.x+=nx*pen*(u1.mass/tm); u2.y+=ny*pen*(u1.mass/tm); }
                }
            }
        }
        // 残骸是刚体障碍
        units.forEach(u => {
            if(u.static) return;
            wrecks.forEach(w => {
                if(w.marked) return;
                const d = Math.hypot(u.x-w.x, u.y-w.y);
                const min = u.radius+w.radius;
                if(d<min) {
                    const pen=min-d;
                    const nx=(u.x-w.x)/d; const ny=(u.y-w.y)/d;
                    // 残骸质量20，骑兵(25)推得动，弩手(5)推不动
                    const ratio = w.mass / (u.mass+w.mass);
                    u.x+=nx*pen*ratio; u.y+=ny*pen*ratio;
                }
            });
        });
    }
}

class EnemyAI {
    static cooldown = 0;
    static difficultyLevel = 1; // 随时间增加

    static update(game: Game) {
        this.cooldown++;
        // 动态难度：时间越久，AI回复越快
        if (game.tick % 600 === 0) this.difficultyLevel += 0.1;
        
        // 只有攒够了钱才行动 (波次逻辑)
        // 假设AI想攒一个由 3个盾 + 2个弩 组成的编队 (~600块)
        if (this.cooldown > 120 && game.enemyRes > 600) {
            this.cooldown = 0;
            this.spawnWave(game);
        }
    }

    static spawnWave(game: Game) {
        // 决策：攻击玩家最脆弱的一路，或者死守自己被攻击的一路
        // 简单起见：随机选一路，但是重拳出击
        const lane = Math.floor(Math.random()*3);
        
        // 瞬间生成一支部队 (Squad)
        game.spawnUnit(Faction.ENEMY, UnitType.SHIELD, lane);
        game.spawnUnit(Faction.ENEMY, UnitType.SHIELD, lane);
        game.spawnUnit(Faction.ENEMY, UnitType.CROSSBOW, lane);
        game.spawnUnit(Faction.ENEMY, UnitType.CROSSBOW, lane);
        
        // 如果很有钱，再加骑兵
        if (game.enemyRes > 300) {
            game.spawnUnit(Faction.ENEMY, UnitType.CAVALRY, lane);
        }
    }
}

// ==========================================
// 5. 游戏主控 (Main Game)
// ==========================================
class Game {
    static inst: Game;
    ctx: CanvasRenderingContext2D;
    
    units: Unit[]=[]; wrecks: Wreckage[]=[]; 
    particles: Particle[]=[]; fx: any[]=[]; texts: any[]=[];
    
    playerRes: number = CONFIG.STARTING_RES;
    enemyRes: number = CONFIG.STARTING_RES;
    score: number = 0; shake: number = 0; tick: number = 0; id: number = 0;

    constructor() {
        Game.inst = this;
        const cvs = document.createElement('canvas');
        cvs.width=CONFIG.WIDTH; cvs.height=CONFIG.HEIGHT;
        document.body.appendChild(cvs);
        this.ctx = cvs.getContext('2d')!;
        
        this.initMap();
        this.initUI();
        this.loop();
    }

    initMap() {
        const px = [80, 250]; // 塔位置更靠后
        const ex = [CONFIG.WIDTH-80, CONFIG.WIDTH-250];
        [0,1,2].forEach(l => {
            px.forEach(x => this.units.push(new Unit(this.id++, UnitType.TOWER, Faction.PLAYER, l, x)));
            ex.forEach(x => this.units.push(new Unit(this.id++, UnitType.TOWER, Faction.ENEMY, l, x)));
        });
    }

    spawnUnit(f: Faction, t: UnitType, l: Lane) {
        const cost = UNIT_STATS[t].cost;
        if(f===Faction.PLAYER) {
            if(this.playerRes < cost) return;
            this.playerRes -= cost;
        } else {
            this.enemyRes -= cost;
        }
        
        // 生成一队 (Squad Count)
        const count = UNIT_STATS[t].count;
        const bx = f===Faction.PLAYER ? 30 : CONFIG.WIDTH-30;
        for(let i=0; i<count; i++) {
            this.units.push(new Unit(this.id++, t, f, l, bx+(Math.random()*40-20)));
        }
    }
    
    addRes(f: Faction, v: number) { 
        if(f===Faction.PLAYER) this.playerRes+=v; 
        else this.enemyRes+=v;
    }

    update() {
        this.tick++;
        
        // 经济循环：非常慢的自然增长
        if (this.tick % 10 === 0) {
            this.playerRes += CONFIG.PASSIVE_INCOME;
            this.enemyRes += CONFIG.PASSIVE_INCOME * EnemyAI.difficultyLevel; // AI作弊：随时间变强
        }

        EnemyAI.update(this);
        Physics.resolve(this.units, this.wrecks);
        
        this.units.forEach(u => u.update(this.units, this.wrecks));
        this.units = this.units.filter(u => !u.dead);
        
        this.particles.forEach(p => p.update());
        this.particles = this.particles.filter(p => p.life>0);
        
        this.wrecks = this.wrecks.filter(w => !w.marked);
        
        this.fx = this.fx.filter(f => { f.life--; return f.life>0; });
        this.texts = this.texts.filter(t => { t.y-=0.5; t.life--; return t.life>0; });

        if(this.shake>0) this.shake*=0.9;
        
        // 胜利进度
        let deep = 0;
        this.units.forEach(u => {
            if(!u.static && u.faction===Faction.PLAYER && u.x>CONFIG.WIDTH*0.8) deep++;
            if(!u.static && u.faction===Faction.ENEMY && u.x<CONFIG.WIDTH*0.2) deep--;
        });
        if(Math.abs(deep)>3) this.score += deep;
    }

    draw() {
        const ctx = this.ctx;
        ctx.fillStyle='#111'; ctx.fillRect(0,0,CONFIG.WIDTH, CONFIG.HEIGHT);
        
        ctx.save();
        if(this.shake>1) ctx.translate(Math.random()*this.shake-this.shake/2, Math.random()*this.shake-this.shake/2);

        // 绘制兵线轨道
        ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=30;
        [0,1,2].forEach(l => {
            ctx.beginPath();
            for(let x=0; x<=CONFIG.WIDTH; x+=20) {
                const y = MapUtils.getLaneY(l, x);
                if(x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
            }
            ctx.stroke();
        });

        this.wrecks.forEach(w => w.draw(ctx));
        this.units.forEach(u => u.draw(ctx));
        this.particles.forEach(p => p.draw(ctx));
        
        // 攻击特效线
        this.fx.forEach(f => {
            ctx.strokeStyle = f.color; ctx.lineWidth=2; ctx.beginPath();
            ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
        });
        
        // 浮动文字
        this.texts.forEach(t => {
            ctx.fillStyle=t.color; ctx.font='12px monospace'; ctx.fillText(t.txt, t.x, t.y);
        });

        ctx.restore();

        // UI
        this.drawUI();
    }

    drawUI() {
        const ctx = this.ctx;
        // 资源栏
        ctx.fillStyle='#fff'; ctx.font='20px monospace'; ctx.textAlign='left';
        ctx.fillText(`COMMAND POINTS: ${Math.floor(this.playerRes)}`, 20, 30);
        
        // 胜利条
        const cx = CONFIG.WIDTH/2;
        ctx.fillStyle='#333'; ctx.fillRect(cx-250, 20, 500, 15);
        const r = this.score / CONFIG.BLOCKADE_THRESHOLD;
        const w = Math.min(Math.abs(r), 1) * 250;
        
        ctx.fillStyle = r>0 ? '#0ff' : '#f05';
        if(r>0) ctx.fillRect(cx, 20, w, 15);
        else ctx.fillRect(cx-w, 20, w, 15);
        
        // 中心刻度
        ctx.fillStyle='#fff'; ctx.fillRect(cx-1, 15, 2, 25);

        if(Math.abs(r)>=1) {
            ctx.fillStyle='rgba(0,0,0,0.9)'; ctx.fillRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
            ctx.fillStyle='#fff'; ctx.font='60px monospace'; ctx.textAlign='center';
            ctx.fillText(r>0?"SECTOR SECURED":"CRITICAL FAILURE", cx, CONFIG.HEIGHT/2);
        }
    }

    initUI() {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:flex;gap:30px;';
        ['TOP','MID','BOT'].forEach((n,i) => {
            const g = document.createElement('div');
            g.innerHTML = `<div style="color:#666;text-align:center;font-family:monospace;margin-bottom:5px">${n}</div>`;
            [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY].forEach(t => {
                const b = document.createElement('button');
                const s = UNIT_STATS[t];
                b.innerHTML = `<span style="color:#eee">${s.label}</span> <span style="color:#888">$${s.cost}</span>`;
                b.onclick = () => this.spawnUnit(Faction.PLAYER, t, i);
                b.style.cssText = `
                    display:block;width:120px;margin:5px;padding:8px;
                    background:#1a1a1a;border:1px solid #333;color:#eee;
                    cursor:pointer;font-family:monospace;text-align:left;font-size:12px;
                    transition:0.2s;
                `;
                b.onmouseover = () => b.style.borderColor = '#0ff';
                b.onmouseout = () => b.style.borderColor = '#333';
                g.appendChild(b);
            });
            box.appendChild(g);
        });
        document.body.appendChild(box);
    }

    loop() {
        this.update(); this.draw();
        requestAnimationFrame(() => this.loop());
    }
}

new Game();
