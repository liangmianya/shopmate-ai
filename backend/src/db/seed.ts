import { nanoid } from 'nanoid';
import { db, migrate, resetData } from './database.js';

const now = () => new Date().toISOString();

const products = [
  {
    id: 'p-shoe-race-pro',
    name: '疾风 Pro 碳板竞速跑鞋',
    brand: 'RunPeak',
    category: '竞速跑鞋',
    price: 899,
    stock: 42,
    features: '全掌碳板、轻量 PEBA 中底、前掌滚动推进，适合半马和全马比赛。',
    sizeGuide: '竞速鞋楦型偏窄，脚宽或脚背高建议比日常运动鞋大半码；长距离比赛建议预留 0.5 到 1 厘米脚趾空间。',
    targetUsers: '有一定跑步基础、配速 3:50 到 5:30 的跑者。',
    scene: '半马、全马、间歇训练、竞速日'
  },
  {
    id: 'p-shoe-daily-cloud',
    name: '云缓震 Daily Trainer 慢跑鞋',
    brand: 'RunPeak',
    category: '缓震慢跑鞋',
    price: 529,
    stock: 88,
    features: '厚底缓震、后跟稳定片、耐磨橡胶外底，适合日常慢跑和恢复跑。',
    sizeGuide: '尺码标准，正常脚型按日常运动鞋尺码购买；脚宽建议选择大半码。',
    targetUsers: '新手跑者、大体重跑者、膝盖敏感或需要高缓震保护的跑者。',
    scene: '日常慢跑、恢复跑、通勤健走'
  },
  {
    id: 'p-shoe-trail-grip',
    name: '山野 TrailGrip 越野跑鞋',
    brand: 'RunPeak',
    category: '越野跑鞋',
    price: 699,
    stock: 31,
    features: '5mm 齿深大底、防撞鞋头、包裹鞋面，适合山路和湿滑路面。',
    sizeGuide: '越野下坡脚趾前冲明显，建议预留 0.8 到 1 厘米空间。',
    targetUsers: '越野跑、山地徒步和复杂路面训练用户。',
    scene: '越野跑、山路训练、轻徒步'
  },
  {
    id: 'p-apparel-compression',
    name: 'PowerRun 压缩裤',
    brand: 'RunPeak',
    category: '跑步服饰',
    price: 239,
    stock: 120,
    features: '渐进式压力、侧边口袋、速干面料，适合长距离训练。',
    sizeGuide: '贴身衣物按身高体重和腿围综合推荐；介于两个尺码之间建议选大一码。',
    targetUsers: '长距离训练、马拉松备赛、需要肌肉支撑的跑者。',
    scene: '长距离慢跑、马拉松训练、健身'
  }
];

const knowledge = [
  {
    type: 'size',
    title: '宽脚用户如何选择竞速跑鞋',
    content: '竞速跑鞋通常楦型偏窄。宽脚、脚背高或拇外翻用户，建议优先选择宽楦款；如果目标款没有宽楦，通常建议比日常运动鞋大半码，并确认前掌没有明显挤压。',
    tags: ['尺码', '宽脚', '竞速鞋'],
    source: 'size-guide'
  },
  {
    type: 'size',
    title: '长距离跑鞋尺码预留规则',
    content: '半马和全马比赛中脚会轻微肿胀，建议脚趾前方预留 0.5 到 1 厘米空间。下坡或越野场景建议预留更多空间，避免顶脚。',
    tags: ['尺码', '半马', '全马'],
    source: 'size-guide'
  },
  {
    type: 'faq',
    title: '碳板跑鞋适合新手吗',
    content: '碳板跑鞋更适合有一定跑步基础、能稳定控制步态的跑者。新手如果主要用于日常慢跑，优先选择缓震训练鞋；如果只用于比赛，可以在试穿舒适的前提下选择。',
    tags: ['碳板', '新手', '竞速'],
    source: 'faq'
  },
  {
    type: 'faq',
    title: '慢跑鞋和竞速鞋有什么区别',
    content: '慢跑鞋重视缓震、稳定和耐用，适合日常训练；竞速鞋重视轻量、回弹和推进感，适合比赛或高强度训练。多数跑者可以用慢跑鞋训练，用竞速鞋比赛。',
    tags: ['慢跑鞋', '竞速鞋'],
    source: 'faq'
  },
  {
    type: 'after_sale',
    title: '7 天无理由退货规则',
    content: '签收后 7 天内，商品未使用、包装吊牌完整、不影响二次销售，可申请无理由退货。跑鞋鞋底有明显户外磨损、服饰吊牌拆除或贴身衣物已清洗，通常不支持无理由退货。',
    tags: ['退货', '售后', '7天无理由'],
    source: 'after-sale-policy'
  },
  {
    type: 'after_sale',
    title: '质量问题换货规则',
    content: '如果出现开胶、断底、严重脱线等疑似质量问题，客户需提供订单号和清晰照片。客服核实后可安排换货、维修或进一步人工处理。',
    tags: ['质量问题', '换货', '照片'],
    source: 'after-sale-policy'
  },
  {
    type: 'product',
    title: '疾风 Pro 碳板竞速跑鞋资料',
    content: '疾风 Pro 碳板竞速跑鞋采用全掌碳板和轻量 PEBA 中底，适合半马、全马和高强度训练。楦型偏窄，宽脚建议大半码。',
    tags: ['疾风 Pro', '碳板', '半马'],
    source: 'product:p-shoe-race-pro'
  },
  {
    type: 'product',
    title: '云缓震 Daily Trainer 慢跑鞋资料',
    content: '云缓震 Daily Trainer 慢跑鞋主打厚底缓震和稳定保护，适合新手、大体重跑者、膝盖敏感用户和日常恢复跑。',
    tags: ['云缓震', '慢跑鞋', '缓震'],
    source: 'product:p-shoe-daily-cloud'
  },
  {
    type: 'product',
    title: 'PowerRun 压缩裤资料',
    content: 'PowerRun 压缩裤使用渐进式压力和速干面料，适合长距离训练和马拉松备赛。贴身衣物尺码需结合身高体重和腿围。',
    tags: ['压缩裤', '长距离', '服饰'],
    source: 'product:p-apparel-compression'
  }
];

function seed() {
  migrate();
  resetData();

  const insertProduct = db.prepare(`
    INSERT INTO products (id, name, brand, category, price, stock, features, size_guide, target_users, scene, created_at, updated_at)
    VALUES (@id, @name, @brand, @category, @price, @stock, @features, @sizeGuide, @targetUsers, @scene, @createdAt, @updatedAt)
  `);

  const insertKnowledge = db.prepare(`
    INSERT INTO knowledge_chunks (id, type, title, content, tags, source, created_at, updated_at)
    VALUES (@id, @type, @title, @content, @tags, @source, @createdAt, @updatedAt)
  `);

  const insertAll = db.transaction(() => {
    for (const product of products) {
      insertProduct.run({ ...product, createdAt: now(), updatedAt: now() });
    }

    for (const item of knowledge) {
      insertKnowledge.run({
        ...item,
        id: nanoid(),
        tags: JSON.stringify(item.tags),
        createdAt: now(),
        updatedAt: now()
      });
    }
  });

  insertAll();
  console.log(`Seeded ${products.length} products and ${knowledge.length} knowledge chunks.`);
}

seed();
