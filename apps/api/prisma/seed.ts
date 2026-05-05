import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Stores
  const store1 = await prisma.store.upsert({
    where: { id: 'store-1' },
    update: {},
    create: {
      id: 'store-1',
      name: 'Axion - Loja Centro',
      region: 'Centro',
      phone: '11999990001',
      email: 'centro@axion.com',
      address: 'Rua das Flores, 100 - Centro',
    },
  });

  const store2 = await prisma.store.upsert({
    where: { id: 'store-2' },
    update: {},
    create: {
      id: 'store-2',
      name: 'Axion - Loja Norte',
      region: 'Norte',
      phone: '11999990002',
      email: 'norte@axion.com',
      address: 'Av. Norte, 200 - Zona Norte',
    },
  });

  const hash = await bcrypt.hash('admin123', 10);

  // Users
  const admin = await prisma.user.upsert({
    where: { email: 'admin@axion.com' },
    update: {},
    create: {
      name: 'Admin Master',
      email: 'admin@axion.com',
      password: hash,
      role: 'ADMIN',
    },
  });

  const diretor = await prisma.user.upsert({
    where: { email: 'diretor@axion.com' },
    update: {},
    create: {
      name: 'João Diretor',
      email: 'diretor@axion.com',
      password: hash,
      role: 'DIRETOR',
    },
  });

  const gerente = await prisma.user.upsert({
    where: { email: 'gerente@loja1.com' },
    update: {},
    create: {
      name: 'Maria Gerente',
      email: 'gerente@loja1.com',
      password: hash,
      role: 'GERENTE',
      storeId: store1.id,
    },
  });

  const vendedor1 = await prisma.user.upsert({
    where: { email: 'vendedor@loja1.com' },
    update: {},
    create: {
      name: 'Carlos Vendedor',
      email: 'vendedor@loja1.com',
      password: hash,
      role: 'VENDEDOR',
      storeId: store1.id,
    },
  });

  const vendedor2 = await prisma.user.upsert({
    where: { email: 'atendente@loja2.com' },
    update: {},
    create: {
      name: 'Ana Atendente',
      email: 'atendente@loja2.com',
      password: hash,
      role: 'ATENDENTE',
      storeId: store2.id,
    },
  });

  // Tags
  const tags = await Promise.all([
    prisma.tag.upsert({ where: { name: 'VIP' }, update: {}, create: { name: 'VIP', color: '#f59e0b' } }),
    prisma.tag.upsert({ where: { name: 'Revendedor' }, update: {}, create: { name: 'Revendedor', color: '#3b82f6' } }),
    prisma.tag.upsert({ where: { name: 'Indicação' }, update: {}, create: { name: 'Indicação', color: '#10b981' } }),
    prisma.tag.upsert({ where: { name: 'Promoção' }, update: {}, create: { name: 'Promoção', color: '#ef4444' } }),
  ]);

  // Custom Fields
  await prisma.customField.upsert({
    where: { key: 'veiculo_interesse' },
    update: {},
    create: { name: 'Veículo de Interesse', key: 'veiculo_interesse', type: 'text' },
  });
  await prisma.customField.upsert({
    where: { key: 'orcamento' },
    update: {},
    create: { name: 'Orçamento', key: 'orcamento', type: 'number' },
  });
  await prisma.customField.upsert({
    where: { key: 'melhor_horario' },
    update: {},
    create: { name: 'Melhor Horário', key: 'melhor_horario', type: 'select', options: JSON.stringify(['Manhã', 'Tarde', 'Noite']) },
  });

  // Sample contacts & leads
  const contactData = [
    { name: 'Pedro Alves', phone: '11911112222' },
    { name: 'Fernanda Lima', phone: '11933334444' },
    { name: 'Roberto Souza', phone: '11955556666' },
    { name: 'Juliana Costa', phone: '11977778888' },
    { name: 'Marcos Silva', phone: '11988889999' },
  ];

  for (let i = 0; i < contactData.length; i++) {
    const c = contactData[i];
    const contact = await prisma.contact.upsert({
      where: { phone: c.phone },
      update: {},
      create: { name: c.name, phone: c.phone },
    });

    const temperatures: any[] = ['FRIO', 'MORNO', 'QUENTE', 'URGENTE', 'QUENTE'];
    const statuses: any[] = ['NOVO', 'EM_CONTATO', 'QUALIFICADO', 'PROPOSTA', 'EM_CONTATO'];

    const lead = await prisma.lead.create({
      data: {
        name: c.name,
        phone: c.phone,
        source: 'WhatsApp',
        temperature: temperatures[i],
        score: 20 + i * 15,
        status: statuses[i],
        contactId: contact.id,
        storeId: i < 3 ? store1.id : store2.id,
        assignedUserId: i < 3 ? vendedor1.id : vendedor2.id,
        region: i < 3 ? 'Centro' : 'Norte',
        interest: 'Honda CG 160',
      },
    });

    const conv = await prisma.conversation.create({
      data: {
        contactId: contact.id,
        leadId: lead.id,
        storeId: i < 3 ? store1.id : store2.id,
        assignedUserId: i < 3 ? vendedor1.id : vendedor2.id,
        status: i === 4 ? 'AGUARDANDO' : 'ABERTA',
        mode: i === 2 ? 'HUMANO' : 'IA_AUTOMATICA',
        aiEnabled: i !== 2,
        lastMessageAt: new Date(Date.now() - i * 600000),
      },
    });

    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: 'INBOUND',
        type: 'TEXT',
        content: `Olá, tenho interesse em uma moto. Pode me ajudar?`,
        createdAt: new Date(Date.now() - i * 600000 - 60000),
      },
    });

    if (i !== 2) {
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: 'OUTBOUND',
          type: 'TEXT',
          content: `Olá ${c.name}! Claro, terei prazer em ajudar. Qual modelo você tem interesse?`,
          createdAt: new Date(Date.now() - i * 600000),
        },
      });
    }
  }

  // AI Config global
  await prisma.aiConfig.upsert({
    where: { storeId: store1.id },
    update: {},
    create: {
      storeId: store1.id,
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 500,
      systemPrompt: 'Você é um atendente especializado em vendas de motos. Seja simpático, objetivo e sempre tente qualificar o lead perguntando sobre modelo, orçamento e melhor horário para contato.',
    },
  });

  console.log('✅ Seed concluído!');
  console.log('');
  console.log('Usuários criados:');
  console.log('  admin@axion.com / admin123 (ADMIN)');
  console.log('  diretor@axion.com / admin123 (DIRETOR)');
  console.log('  gerente@loja1.com / admin123 (GERENTE)');
  console.log('  vendedor@loja1.com / admin123 (VENDEDOR)');
  console.log('  atendente@loja2.com / admin123 (ATENDENTE)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
