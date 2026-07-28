import { nanoid } from 'nanoid';
import { db, migrate, resetData } from './database.js';

const now = () => new Date().toISOString();

const products = [
  {
    id: 'p-skincare-eye-cream',
    name: '多效修护眼霜',
    brand: 'VitaSkin',
    category: '眼部护理',
    price: 199,
    stock: 86,
    features: '淡化黑眼圈、改善干纹，质地轻薄，适合早晚护理。',
    sizeGuide: '建议每次取米粒大小，沿眼周轻点按压，不要靠近眼球。',
    targetUsers: '眼周干燥、熬夜后暗沉或初期细纹用户。',
    scene: '日常护肤、妆前护理、夜间修护',
    purchaseUrl: 'https://example.com/products/eye-cream'
  },
  {
    id: 'p-skincare-cleanser',
    name: '净润氨基酸洁面',
    brand: 'VitaSkin',
    category: '洁面乳',
    price: 79,
    stock: 241,
    features: '温和控油、弱酸配方，泡沫细腻，早晚可用。',
    sizeGuide: '每次取黄豆大小，加水揉搓起泡后轻柔清洁。',
    targetUsers: '油皮、混合皮和追求温和清洁的用户。',
    scene: '晨间洁面、晚间清洁、通勤护肤',
    purchaseUrl: 'https://example.com/products/cleanser'
  },
  {
    id: 'p-beauty-brow-pencil',
    name: '定型防水眉笔',
    brand: 'RosyDream',
    category: '眉部彩妆',
    price: 69,
    stock: 266,
    features: '不易晕染、双头设计，新手友好。',
    sizeGuide: '根据发色选择相近色号，少量多次描画更自然。',
    targetUsers: '日常通勤妆、初学化妆和需要持久妆效的用户。',
    scene: '日常妆容、通勤、出游',
    purchaseUrl: 'https://example.com/products/brow-pencil'
  },
  {
    id: 'p-beauty-cushion',
    name: '柔雾哑光粉底液',
    brand: 'RosyDream',
    category: '底妆',
    price: 129,
    stock: 152,
    features: '柔焦遮瑕、持妆不拔干，适合日常通勤。',
    sizeGuide: '建议根据肤色深浅选择色号；干皮可先做好保湿打底。',
    targetUsers: '需要自然遮瑕和持久妆效的用户。',
    scene: '通勤妆、约会妆、轻正式场合',
    purchaseUrl: 'https://example.com/products/foundation'
  }
];

const knowledge = [
  {
    type: 'size',
    title: '如何选择商品规格或色号',
    content: '客户不确定规格、尺寸或色号时，先确认使用场景、常用规格、肤色或偏好，再结合商品详情和库存给出建议；信息不足时应先追问。',
    tags: ['规格', '色号', '选购'],
    source: 'size-guide'
  },
  {
    type: 'size',
    title: '敏感人群购买前注意事项',
    content: '敏感肌、孕期、儿童或有特殊护理需求的客户，建议先查看成分、适用说明和禁忌信息；必要时建议先局部试用或咨询专业人士。',
    tags: ['敏感肌', '适用人群', '注意事项'],
    source: 'size-guide'
  },
  {
    type: 'faq',
    title: '如何根据预算推荐商品',
    content: '推荐商品时先确认预算、用途、偏好和最在意的因素。只推荐商品库中真实存在的商品，不编造价格、库存或活动。',
    tags: ['推荐', '预算', '选购'],
    source: 'faq'
  },
  {
    type: 'faq',
    title: '购买链接如何提供',
    content: '当客户询问购买入口时，优先使用商品库中的购买链接。若商品没有配置链接，应说明暂未配置，并建议客户提供想看的具体商品。',
    tags: ['购买链接', '下单', '商品'],
    source: 'faq'
  },
  {
    type: 'after_sale',
    title: '7 天无理由退货规则',
    content: '签收后 7 天内，商品未使用、包装吊牌完整、不影响二次销售，可申请无理由退货。已明显使用、包装缺失、贴身或特殊类目商品，需按店铺规则核实是否支持退货。',
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
    title: '多效修护眼霜资料',
    content: '多效修护眼霜主打淡化黑眼圈和改善干纹，质地轻薄，适合早晚护理。购买链接：https://example.com/products/eye-cream',
    tags: ['多效修护眼霜', '眼部护理', 'VitaSkin'],
    source: 'product:p-skincare-eye-cream'
  },
  {
    type: 'product',
    title: '净润氨基酸洁面资料',
    content: '净润氨基酸洁面采用弱酸配方，温和控油，适合晨间和晚间清洁。购买链接：https://example.com/products/cleanser',
    tags: ['净润氨基酸洁面', '洁面乳', 'VitaSkin'],
    source: 'product:p-skincare-cleanser'
  },
  {
    type: 'product',
    title: '定型防水眉笔资料',
    content: '定型防水眉笔不易晕染，双头设计，新手友好。购买链接：https://example.com/products/brow-pencil',
    tags: ['定型防水眉笔', '眉部彩妆', 'RosyDream'],
    source: 'product:p-beauty-brow-pencil'
  }
];

function seed() {
  migrate();
  resetData();

  const insertProduct = db.prepare(`
    INSERT INTO products (id, name, brand, category, price, stock, features, size_guide, target_users, scene, purchase_url, created_at, updated_at)
    VALUES (@id, @name, @brand, @category, @price, @stock, @features, @sizeGuide, @targetUsers, @scene, @purchaseUrl, @createdAt, @updatedAt)
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
