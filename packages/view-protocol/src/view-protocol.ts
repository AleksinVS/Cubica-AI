/**
 * Abstract View Protocol Definitions
 * Defines the contract for the Abstract View Layer (Presenter -> View communication).
 */

/**
 * A command sent from the Presenter to the View.
 * Describes an abstract action to be performed by the UI.
 */
export interface ViewCommand {
  /**
   * The abstract action type.
   * Examples: 'SYNC_STATE', 'PLAY_FX', 'SHOW_DIALOG', 'NAVIGATE', 'DISPLAY_MESSAGE'.
   */
  type: string;

  /**
   * Data required to execute the command.
   * Structure depends on the `type`.
   */
  payload: Record<string, any>;

  /**
   * Optional metadata for flow control and prioritization.
   */
  meta?: {
    /**
     * Expected duration of the action in milliseconds.
     * Can be used by the Presenter to coordinate timing, or by the View to adjust animation speed.
     */
    duration?: number;

    /**
     * Priority of the command.
     * - 'high': Interrupts current actions if possible (e.g., Error).
     * - 'normal': Standard queue.
     * - 'background': Executes without blocking (e.g., ambient fx).
     */
    priority?: 'high' | 'normal' | 'background';

    /**
     * If true, this command should be treated as a "state sync" checkpoint.
     */
    isSync?: boolean;

    [key: string]: any;
  };
}

/**
 * The response returned by the View after processing a command.
 */
export interface ViewResponse {
  /**
   * Status of the command execution.
   */
  status: 'COMPLETED' | 'INTERRUPTED' | 'FAILED';

  /**
   * Optional result data.
   * Populated if the command was a query or interaction (e.g., dialog choice).
   */
  payload?: any;

  /**
   * Error details if status is 'FAILED'.
   */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * The Gateway Interface for the Abstract View Layer.
 * Presenters must use this interface to communicate with the View.
 */
export interface IViewGateway {
  /**
   * Dispatches a command to the View.
   * Returns a Promise that resolves when the View has finished processing the command
   * (e.g., animation ended, user closed modal).
   *
   * @param command The abstract command to execute.
   * @returns A promise resolving to the result of the execution.
   */
  dispatch(command: ViewCommand): Promise<ViewResponse>;
}

