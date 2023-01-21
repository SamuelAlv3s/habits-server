import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./lib/prisma";
import dayjs from "dayjs";

export async function appRoutes(app: FastifyInstance) {
  app.post("/habits", async (request) => {
    const createHabitBody = z.object({
      title: z.string(),
      weekDays: z.array(z.number().min(0).max(6)),
    });

    const today = dayjs().startOf("day").toDate();

    const { title, weekDays } = createHabitBody.parse(request.body);
    await prisma.habit.create({
      data: {
        title,
        createdAt: today,
        weekDays: {
          create: weekDays.map((weekDay) => ({ week_day: weekDay })),
        },
      },
    });
    return;
  });

  app.get("/day", async (request) => {
    const getDayParams = z.object({
      date: z.coerce.date(),
    });

    const { date } = getDayParams.parse(request.query);

    const parsedDate = dayjs(date).startOf("day");
    const weekDay = parsedDate.get("day");

    const possibleHabits = await prisma.habit.findMany({
      where: {
        createdAt: {
          lte: date,
        },
        weekDays: {
          some: {
            week_day: weekDay,
          },
        },
      },
    });

    const day = await prisma.day.findUnique({
      where: {
        date: parsedDate.toDate(),
      },
      include: {
        dayHabits: true,
      },
    });

    const completedHabits = day?.dayHabits.map((dayHabit) => dayHabit.habit_id);

    return {
      possibleHabits,
      completedHabits,
    };
  });

  app.patch("/habits/:id/toggle", async (request) => {
    const toggleCompleteParams = z.object({
      id: z.string().uuid(),
    });

    const { id } = toggleCompleteParams.parse(request.params);

    const today = dayjs().startOf("day").toDate();

    let day = await prisma.day.findUnique({
      where: {
        date: today,
      },
    });

    if (!day) {
      day = await prisma.day.create({
        data: {
          date: today,
        },
      });
    }

    const dayHabit = await prisma.dayHabit.findUnique({
      where: {
        day_id_habit_id: {
          habit_id: id,
          day_id: day.id,
        },
      },
    });

    if (dayHabit) {
      await prisma.dayHabit.delete({
        where: {
          id: dayHabit.id,
        },
      });
    } else {
      await prisma.dayHabit.create({
        data: {
          habit_id: id,
          day_id: day.id,
        },
      });
    }
  });

  app.get("/summary", async (request) => {
    const summary = await prisma.$queryRaw`
      SELECT
       D.id,
       D.date,
       (
          SELECT cast(COUNT(*) as float)
          FROM day_habits DH
          WHERE DH.day_id = D.id
       ) as completed,
       (
          SELECT cast(COUNT(*) as float)
          FROM habit_week_days HWD
          JOIN habits H 
          ON H.id = HWD.habit_id
          WHERE HWD.week_day = cast(strftime('%w', D.date/1000, 'unixepoch') as int)
          AND H.createdAt <= D.date
       ) as amount
      FROM days D
    `;

    return summary;
  });
}
