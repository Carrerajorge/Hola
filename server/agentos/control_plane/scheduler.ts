export interface ScheduledTask {
  id: string;
  userId: string;
  description: string;
  dueAt: number;
  status: "pending" | "executed" | "cancelled";
}

export class TaskScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private interval: NodeJS.Timeout | null = null;

  start() {
    this.interval = setInterval(() => this.checkTasks(), 60000); // Check cada minuto
    console.log("[Scheduler] ⏰ Service started.");
  }

  schedule(userId: string, description: string, minutesFromNow: number) {
    const id = `task_${Date.now()}`;
    this.tasks.set(id, {
        id,
        userId,
        description,
        dueAt: Date.now() + (minutesFromNow * 60000),
        status: "pending"
    });
    console.log(`[Scheduler] Task scheduled for ${userId} in ${minutesFromNow}m: "${description}"`);
    return id;
  }

  private checkTasks() {
    const now = Date.now();
    this.tasks.forEach((task, id) => {
        if (task.status === "pending" && task.dueAt <= now) {
            this.executeTask(task);
        }
    });
  }

  private executeTask(task: ScheduledTask) {
    console.log(`[Scheduler] 🔔 ALARM TRIGGERED for ${task.userId}: "${task.description}"`);
    // En un sistema real, aquí inyectaríamos un mensaje proactivo en el chat del usuario.
    // Como estamos en el backend, simulamos la notificación.
    task.status = "executed";
    
    // TODO: Call agentOS.action.execute('send_notification', ...)
  }
}
