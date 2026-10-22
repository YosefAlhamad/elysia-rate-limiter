import type { ReactElement } from 'react'
import type { Scenario } from '../lab/traffic/scenarios'

interface ScenarioPickerProps {
  readonly scenarios: readonly Scenario[]
  readonly pendingArrivals: number
  readonly onStart: (scenario: Scenario) => void
}

export function ScenarioPicker({ scenarios, pendingArrivals, onStart }: ScenarioPickerProps): ReactElement {
  return (
    <div className="scenarios">
      <div className="scenarios__header">
        <h3 className="scenarios__title">Try a scenario</h3>
        <p className={pendingArrivals > 0 ? 'scenarios__status scenarios__status--active' : 'scenarios__status'}>
          {pendingArrivals > 0 ? `${pendingArrivals} requests on the way` : 'Each one schedules requests on the shared clock'}
        </p>
      </div>
      <div className="scenarios__grid">
        {scenarios.map((scenario) => (
          <button key={scenario.id} className="scenario-card" type="button" onClick={() => onStart(scenario)}>
            <span className="scenario-card__title">{scenario.title}</span>
            <span className="scenario-card__description">{scenario.description}</span>
            <span className="scenario-card__action">
              Run scenario <span aria-hidden="true">→</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
