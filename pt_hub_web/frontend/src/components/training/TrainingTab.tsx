import { TrainingControls } from './TrainingControls';
import { NeuralSignals } from './NeuralSignals';
import { TrainerOutput } from './TrainerOutput';

export function TrainingTab() {
  return (
    <div className="flex h-full">
      {/* Left side - Training Controls & Neural Signals (50%) */}
      <div className="w-1/2 border-r border-dark-border flex flex-col">
        {/* Training Controls */}
        <div className="h-1/2 border-b border-dark-border overflow-auto">
          <TrainingControls />
        </div>

        {/* Neural Signals */}
        <div className="h-1/2 overflow-auto">
          <NeuralSignals />
        </div>
      </div>

      {/* Right side - Trainer Output (50%) */}
      <div className="w-1/2 flex flex-col">
        <TrainerOutput />
      </div>
    </div>
  );
}
