/**
 * AppStateMachine.ts
 * 
 * Formal Navigation & Session State Machine for Asimov Controller 3D.
 * Replaces benchmark-centric ad-hoc mode switches with an operator-first
 * deterministic lifecycle:
 * 
 * Screen Lifecycle:
 *   BOOT -> HOME -> CONNECTING -> TELEOPERATION
 *            │                     │
 *            ├──> SETTINGS <───────┤
 *            │
 *            └──> BENCHMARK (legacy engineering suite)
 * 
 * Global Connection Lifecycle:
 *   DISCONNECTED -> CONNECTING -> CONNECTED <--> DEGRADED
 *        ▲              │              │
 *        │              ▼              ▼
 *        └─────────── FAILED <─── RECONNECTING
 */

export type AppScreen = 'BOOT' | 'HOME' | 'CONNECTING' | 'TELEOPERATION' | 'SETTINGS' | 'BENCHMARK';

export type GlobalConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'RECONNECTING'
  | 'FAILED';

export interface StateMachineSnapshot {
  screen: AppScreen;
  connectionState: GlobalConnectionState;
  previousScreen: AppScreen;
  errorMessage: string | null;
  timestamp: number;
}

export type StateMachineListener = (snapshot: StateMachineSnapshot) => void;

export class AppStateMachine {
  private currentScreen: AppScreen = 'BOOT';
  private previousScreen: AppScreen = 'HOME';
  private connectionState: GlobalConnectionState = 'DISCONNECTED';
  private errorMessage: string | null = null;
  private listeners: Set<StateMachineListener> = new Set();
  private history: StateMachineSnapshot[] = [];
  private maxHistory: number = 20;

  constructor(initialScreen: AppScreen = 'BOOT') {
    this.currentScreen = initialScreen;
    this.recordSnapshot();
  }

  public getScreen(): AppScreen {
    return this.currentScreen;
  }

  public getConnectionState(): GlobalConnectionState {
    return this.connectionState;
  }

  public getPreviousScreen(): AppScreen {
    return this.previousScreen;
  }

  public getErrorMessage(): string | null {
    return this.errorMessage;
  }

  public getSnapshot(): StateMachineSnapshot {
    return {
      screen: this.currentScreen,
      connectionState: this.connectionState,
      previousScreen: this.previousScreen,
      errorMessage: this.errorMessage,
      timestamp: Date.now(),
    };
  }

  public getHistory(): readonly StateMachineSnapshot[] {
    return this.history;
  }

  /**
   * Navigate to a target application screen.
   */
  public navigate(target: AppScreen): boolean {
    if (this.currentScreen === target) return true;

    // Validate navigation paths
    if (this.currentScreen === 'BOOT' && target !== 'HOME') {
      console.warn(`[AppStateMachine] Invalid transition from BOOT to ${target}`);
      return false;
    }

    this.previousScreen = this.currentScreen;
    this.currentScreen = target;
    this.recordSnapshot();
    this.notify();
    return true;
  }

  /**
   * Return from modal/overlay screen (e.g., SETTINGS -> previous screen).
   */
  public goBack(): boolean {
    if (this.currentScreen === 'SETTINGS') {
      const destination = this.previousScreen === 'SETTINGS' ? 'HOME' : this.previousScreen;
      return this.navigate(destination);
    }
    if (this.currentScreen === 'BENCHMARK' || this.currentScreen === 'CONNECTING') {
      return this.navigate('HOME');
    }
    if (this.currentScreen === 'TELEOPERATION') {
      return this.navigate('HOME');
    }
    return false;
  }

  /**
   * Update global connection state.
   */
  public setConnectionState(nextState: GlobalConnectionState, errorReason?: string): void {
    if (this.connectionState === nextState && !errorReason) return;

    this.connectionState = nextState;
    if (errorReason !== undefined) {
      this.errorMessage = errorReason;
    } else if (nextState === 'CONNECTED' || nextState === 'DISCONNECTED') {
      this.errorMessage = null;
    }

    // Automatic screen transitions tied to connection events
    if (nextState === 'CONNECTING' && this.currentScreen === 'HOME') {
      this.navigate('CONNECTING');
    } else if (nextState === 'CONNECTED' && (this.currentScreen === 'CONNECTING' || this.currentScreen === 'HOME')) {
      this.navigate('TELEOPERATION');
    } else if (nextState === 'FAILED' && this.currentScreen === 'CONNECTING') {
      this.navigate('HOME');
    }

    this.recordSnapshot();
    this.notify();
  }

  /**
   * Subscribe to state machine transitions.
   */
  public subscribe(listener: StateMachineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private recordSnapshot(): void {
    const snapshot = this.getSnapshot();
    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[AppStateMachine] Error in listener callback:', err);
      }
    }
  }
}
