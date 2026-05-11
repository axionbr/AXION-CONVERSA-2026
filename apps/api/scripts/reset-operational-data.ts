import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function countIfExists(modelName: string) {
  const model = (prisma as any)[modelName];
  if (!model?.count) return null;
  return model.count();
}

async function deleteIfExists(modelName: string) {
  const model = (prisma as any)[modelName];
  if (!model?.deleteMany) return null;
  return model.deleteMany({});
}

async function main() {
  if (process.env.RESET_CONFIRM !== "YES") {
    console.log("ABORTADO: para executar, use RESET_CONFIRM=YES npm run db:reset-operational");
    process.exit(1);
  }

  console.log("Reset operacional iniciado.");
  console.log("NÃO serão apagados: users, admins, vendedores, login, .env, tokens ou configurações.");

  const models = [
    "sellerNotification",
    "automationLog",
    "aiAnalysis",
    "message",
    "conversation",
    "lead",
    "contact",
  ];

  console.log("\nContagem antes:");
  for (const model of models) {
    const count = await countIfExists(model);
    if (count !== null) console.log(`${model}: ${count}`);
  }

  console.log("\nApagando dados operacionais...");
  for (const model of models) {
    const result = await deleteIfExists(model);
    if (result !== null) console.log(`${model}: ${result.count} apagados`);
  }

  console.log("\nContagem depois:");
  for (const model of models) {
    const count = await countIfExists(model);
    if (count !== null) console.log(`${model}: ${count}`);
  }

  console.log("\nReset operacional concluído com segurança.");
}

main()
  .catch((error) => {
    console.error("Erro no reset operacional:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
