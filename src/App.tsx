import React, { useState } from 'react';
import { Header } from './components/Header';
import { FabricStatusPanel, useFabricStatus } from './components/FabricStatus';
import { ServicesTab } from './components/ServicesTab';
import { CapabilitiesTab } from './components/CapabilitiesTab';
import { RunTab } from './components/RunTab';
import { EvidenceTab } from './components/EvidenceTab';
import { RunsTab } from './components/RunsTab';
import { SecurityTestsTab } from './components/SecurityTestsTab';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('fabric');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const fabric = useFabricStatus();

  const openEvent = (id: string) => {
    setSelectedEventId(id);
    setActiveTab('evidence');
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-16">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} fabric={fabric} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-4">
        {activeTab === 'fabric' && <FabricStatusPanel fabric={fabric} />}
        {activeTab === 'services' && <ServicesTab />}
        {activeTab === 'capabilities' && <CapabilitiesTab fabric={fabric} />}
        {/* Kept mounted so a run's result survives a trip to the Evidence tab. */}
        <div hidden={activeTab !== 'run'}>
          <RunTab onOpenEvent={openEvent} executionMode={fabric.data?.executionMode} />
        </div>
        {activeTab === 'evidence' && <EvidenceTab selectedEventId={selectedEventId} onSelectEvent={setSelectedEventId} />}
        {activeTab === 'runs' && <RunsTab onOpenEvent={openEvent} />}
        {activeTab === 'security' && <SecurityTestsTab />}
      </main>
    </div>
  );
}
