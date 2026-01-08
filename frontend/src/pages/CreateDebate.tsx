import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { ArrowLeft, Plus } from 'lucide-react';

interface Model {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string; image: string; request: string };
  context_length: number;
}

const CreateDebate = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  
  const [settings, setSettings] = useState({
    topic: '',
    description: '',
    language: 'English',
    num_rounds: 3, 
    length_preset: 'medium', // short, medium, long
    moderator_model: '',
    num_participants: 2, // 2-5
  });

  const [participants, setParticipants] = useState([
      { name: 'Debater 1', model: '', prompt: 'You are a skilled debater. Argue in favor of the topic.', position: 1 },
      { name: 'Debater 2', model: '', prompt: 'You are a skilled debater. Argue against the topic.', position: 2 }
  ]);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await api.get('/models/');
        // Backend returns { data: [...], timestamp: ... }
        const modelsList = res.data.data || [];
        setModels(modelsList);
        if (modelsList.length > 0) {
            setSettings(prev => ({ ...prev, moderator_model: modelsList[0].id }));
            
            setParticipants(prev => prev.map(p => ({
                ...p,
                model: modelsList[0].id
            })));
        }
      } catch (err) {
        console.error("Failed to fetch models", err);
      }
    };
    fetchModels();
  }, []);

  // Update participant count
  useEffect(() => {
     setParticipants(prev => {
         const newCount = settings.num_participants;
         if (newCount === prev.length) return prev;
         
         if (newCount > prev.length) {
             // Add participants
             const added = [];
             for (let i = prev.length + 1; i <= newCount; i++) {
                 added.push({
                     name: `Debater ${i}`,
                     model: models.length > 0 ? models[0].id : '',
                     prompt: `You are a skilled debater. Provide a unique perspective on the topic (Position ${i}).`,
                     position: i
                 });
             }
             return [...prev, ...added];
         } else {
             // Remove participants
             return prev.slice(0, newCount);
         }
     });
  }, [settings.num_participants, models]);

  const updateParticipant = (index: number, field: string, value: string) => {
      const newP = [...participants];
      newP[index] = { ...newP[index], [field]: value };
      setParticipants(newP);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const defaultModModel = settings.moderator_model || (models.length > 0 ? models[0].id : '');

      // Construct payload
      const payload = {
        topic: settings.topic,
        description: settings.description,
        language: settings.language,
        num_rounds: settings.num_rounds,
        length_preset: settings.length_preset,
        debate_preset_id: "custom",
        participants: [
            // Moderator
            {
                role: "moderator",
                model_id: defaultModModel,
                display_name: "Moderator",
                persona_custom: "You are an impartial debate moderator. Briefly introduce the next speaker and summarize the current state of the debate."
            },
            // Dynamic Debaters
            ...participants.map(p => ({
                role: "debater",
                model_id: p.model,
                display_name: p.name,
                persona_custom: p.prompt
            }))
        ]
      };

      const res = await api.post('/debates/', payload);
      navigate(`/debate/${res.data.debate_id}`);
    } catch (err) {
      console.error("Failed to create debate", err);
      alert("Error creating debate");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <button onClick={() => navigate('/')} className="flex items-center text-gray-600 mb-6 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Home
      </button>

      <h1 className="text-3xl font-bold mb-8">Create New Debate</h1>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <h2 className="text-xl font-semibold mb-4">Topic & Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Debate Topic</label>
              <input
                type="text"
                required
                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={settings.topic}
                onChange={e => setSettings({...settings, topic: e.target.value})}
                placeholder="e.g. Is AI dangerous?"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
              <textarea
                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                value={settings.description}
                onChange={e => setSettings({...settings, description: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
              <select
                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                value={settings.language}
                onChange={e => setSettings({...settings, language: e.target.value})}
              >
                <option value="English">English</option>
                <option value="Russian">Russian</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Chinese">Chinese</option>
              </select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Number of Rounds</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    value={settings.num_rounds}
                    onChange={e => setSettings({...settings, num_rounds: parseInt(e.target.value)})}
                  />
                </div>
                
                 <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Participants</label>
                  <select
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    value={settings.num_participants}
                    onChange={e => setSettings({...settings, num_participants: parseInt(e.target.value)})}
                  >
                    {[2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
            </div>
            
             <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Response Length</label>
              <select
                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                value={settings.length_preset}
                onChange={e => setSettings({...settings, length_preset: e.target.value})}
              >
                <option value="short">Short (~100 words)</option>
                <option value="medium">Medium (~250 words)</option>
                <option value="long">Long (~500 words)</option>
              </select>
            </div>

            <div className="pt-2 border-t border-gray-100 mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Moderator Model</label>
                <select
                  className="w-full p-2 border border-gray-300 rounded"
                  value={settings.moderator_model}
                  onChange={e => setSettings({...settings, moderator_model: e.target.value})}
                >
                  {models.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
            </div>

          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {participants.map((p, idx) => (
             <div key={idx} className="bg-white p-6 rounded-lg shadow border border-gray-200">
               <h2 className="text-xl font-semibold mb-4 text-gray-800">
                   {idx === 0 ? "Participant 1 (Pro)" : idx === 1 ? "Participant 2 (Con)" : `Participant ${idx + 1}`}
               </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Name</label>
                    <input
                      type="text"
                      required
                      className="w-full p-2 border border-gray-300 rounded"
                      value={p.name}
                      onChange={e => updateParticipant(idx, 'name', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Model</label>
                    <select
                      className="w-full p-2 border border-gray-300 rounded"
                      value={p.model}
                      onChange={e => updateParticipant(idx, 'model', e.target.value)}
                    >
                      {models.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">System Prompt</label>
                    <textarea
                      rows={4}
                      className="w-full p-2 border border-gray-300 rounded text-sm"
                      value={p.prompt}
                      onChange={e => updateParticipant(idx, 'prompt', e.target.value)}
                    />
                  </div>
                </div>
              </div>
          ))}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center py-4 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 font-bold text-lg"
        >
          {loading ? 'Starting Debate...' : <><Plus className="w-5 h-5 mr-2"/> Start Debate</>}
        </button>
      </form>
    </div>
  );
};

export default CreateDebate;
