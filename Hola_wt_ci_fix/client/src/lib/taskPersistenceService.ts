export interface BackgroundTask {
  id?: number;
  action: string;
  row?: number;
  col?: number;
  value?: any;
  formula?: string;
  format?: Record<string, any>;
  cells?: Array<{ row: number; col: number; value: any }>;
  sheetId?: string;
  name?: string;
  chartType?: string;
  dataRange?: string;
  options?: Record<string, any>;
  range?: string;
  context?: Record<string, any>;
  priority?: number;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  attempts?: number;
}

export interface TaskResult {
  id?: number;
  taskId: number;
  result: any;
  completedAt: number;
}

export interface ProcessingState {
  key: string;
  value: any;
  updatedAt: number;
}

export class TaskPersistenceService {
  private dbName = 'ExcelBackgroundProcessing';
  private dbVersion = 2;
  private db: IDBDatabase | null = null;
  private stores = {
    tasks: 'pendingTasks',
    results: 'completedResults',
    state: 'processingState'
  };

  async initialize(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(new Error('Failed to open IndexedDB'));

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        console.log('✅ IndexedDB inicializado');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(this.stores.tasks)) {
          const taskStore = db.createObjectStore(this.stores.tasks, { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          taskStore.createIndex('status', 'status', { unique: false });
          taskStore.createIndex('priority', 'priority', { unique: false });
          taskStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.stores.results)) {
          const resultStore = db.createObjectStore(this.stores.results, { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          resultStore.createIndex('taskId', 'taskId', { unique: false });
          resultStore.createIndex('completedAt', 'completedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.stores.state)) {
          db.createObjectStore(this.stores.state, { keyPath: 'key' });
        }
      };
    });
  }

  async saveTasks(tasks: BackgroundTask[]): Promise<number[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const tx = this.db.transaction(this.stores.tasks, 'readwrite');
    const store = tx.objectStore(this.stores.tasks);
    
    const ids: number[] = [];
    for (const task of tasks) {
      const taskWithMeta = {
        ...task,
        status: 'pending',
        priority: task.priority || 0,
        createdAt: Date.now(),
        attempts: 0
      };
      const id = await this._promisifyRequest<number>(store.add(taskWithMeta));
      ids.push(id);
    }
    
    return ids;
  }

  async getPendingTasks(): Promise<BackgroundTask[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const tx = this.db.transaction(this.stores.tasks, 'readonly');
    const store = tx.objectStore(this.stores.tasks);
    const index = store.index('status');
    return this._promisifyRequest<BackgroundTask[]>(index.getAll('pending'));
  }

  async updateTaskStatus(taskId: number, status: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const tx = this.db.transaction(this.stores.tasks, 'readwrite');
    const store = tx.objectStore(this.stores.tasks);
    
    const task = await this._promisifyRequest<BackgroundTask>(store.get(taskId));
    if (task) {
      task.status = status;
      task.updatedAt = Date.now();
      await this._promisifyRequest(store.put(task));
    }
  }

  async removeCompletedTasks(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const tx = this.db.transaction(this.stores.tasks, 'readwrite');
    const store = tx.objectStore(this.stores.tasks);
    const index = store.index('status');
    
    const completed = await this._promisifyRequest<IDBValidKey[]>(index.getAllKeys('completed'));
    for (const key of completed) {
      await this._promisifyRequest(store.delete(key));
    }
  }

  async clearAllTasks(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const tx = this.db.transaction(this.stores.tasks, 'readwrite');
    const store = tx.objectStore(this.stores.tasks);
    await this._promisifyRequest(store.clear());
  }

  async saveResult(taskId: number, result: any): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    
    const tx = this.db.transaction(this.stores.results, 'readwrite');
    const store = tx.objectStore(this.stores.results);
    
    const resultWithMeta = {
      taskId,
      result,
      completedAt: Date.now()
    };
    
    return this._promisifyRequest<number>(store.add(resultWithMeta));
  }

  async getResults(since = 0): Promise<TaskResult[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const tx = this.db.transaction(this.stores.results, 'readonly');
    const store = tx.objectStore(this.stores.results);
    const index = store.index('completedAt');
    const range = IDBKeyRange.lowerBound(since);
    return this._promisifyRequest<TaskResult[]>(index.getAll(range));
  }

  async clearResults(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const tx = this.db.transaction(this.stores.results, 'readwrite');
    const store = tx.objectStore(this.stores.results);
    await this._promisifyRequest(store.clear());
  }

  async saveState(key: string, value: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const tx = this.db.transaction(this.stores.state, 'readwrite');
    const store = tx.objectStore(this.stores.state);
    await this._promisifyRequest(store.put({ key, value, updatedAt: Date.now() }));
  }

  async getState(key: string): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');
    
    const tx = this.db.transaction(this.stores.state, 'readonly');
    const store = tx.objectStore(this.stores.state);
    const result = await this._promisifyRequest<ProcessingState>(store.get(key));
    return result?.value;
  }

  private _promisifyRequest<T>(request: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  }
}
