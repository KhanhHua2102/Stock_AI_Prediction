import { useTrainingStore } from '../../store/trainingStore';
import { LogViewer } from '../common/LogViewer';

export function TrainerOutput() {
  const { trainerLogs, clearTrainerLogs } = useTrainingStore();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-dark-bg2 border-b border-dark-border">
        <h3 className="text-sm font-semibold text-dark-fg">Trainer Output</h3>
        <button
          onClick={clearTrainerLogs}
          className="px-3 py-1 text-xs text-dark-muted hover:text-dark-fg"
        >
          Clear
        </button>
      </div>

      {/* Log content */}
      <LogViewer logs={trainerLogs} className="flex-1" />
    </div>
  );
}
