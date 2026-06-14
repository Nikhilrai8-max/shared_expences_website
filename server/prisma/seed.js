import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Clean up existing data
  await prisma.importAnomaly.deleteMany();
  await prisma.split.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();

  // 2. Create Users
  const users = {};
  const userNames = ['Aisha', 'Rohan', 'Priya', 'Meera', 'Sam', 'Dev'];
  for (const name of userNames) {
    users[name] = await prisma.user.create({
      data: {
        name,
        email: `${name.toLowerCase()}@flatmates.com`,
      },
    });
  }
  console.log(`Created ${Object.keys(users).length} users.`);

  // 3. Create Groups
  const groupFlat = await prisma.group.create({
    data: {
      name: 'Flat',
      description: 'Shared flat household expenses',
    },
  });

  const groupTrip = await prisma.group.create({
    data: {
      name: 'Trip',
      description: 'Holiday spending in US Dollars and other currencies',
    },
  });
  console.log('Created groups: Flat, Trip');

  // 4. Create memberships with specific joining/leaving dates
  // Aisha, Rohan, Priya joined Flat on Feb 1, 2025 and are still active
  const startOfFeb = new Date('2025-02-01T00:00:00Z');
  const endOfMarch = new Date('2025-03-31T23:59:59Z');
  const midApril = new Date('2025-04-15T00:00:00Z');
  const startOfApril = new Date('2025-04-01T00:00:00Z');
  const midAprilTripEnd = new Date('2025-04-15T23:59:59Z');

  const memberships = [
    // Flat Memberships
    { group: groupFlat, user: users.Aisha, joined: startOfFeb, left: null },
    { group: groupFlat, user: users.Rohan, joined: startOfFeb, left: null },
    { group: groupFlat, user: users.Priya, joined: startOfFeb, left: null },
    { group: groupFlat, user: users.Meera, joined: startOfFeb, left: endOfMarch }, // Meera left end of March
    { group: groupFlat, user: users.Sam, joined: midApril, left: null },          // Sam joined mid-April

    // Trip Memberships
    { group: groupTrip, user: users.Aisha, joined: startOfApril, left: null },
    { group: groupTrip, user: users.Rohan, joined: startOfApril, left: null },
    { group: groupTrip, user: users.Priya, joined: startOfApril, left: null },
    { group: groupTrip, user: users.Dev, joined: startOfApril, left: midAprilTripEnd }, // Dev joined only for the trip
  ];

  for (const m of memberships) {
    await prisma.membership.create({
      data: {
        groupId: m.group.id,
        userId: m.user.id,
        joinedAt: m.joined,
        leftAt: m.left,
      },
    });
  }

  console.log('Successfully seeded database with users, groups, and memberships!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
