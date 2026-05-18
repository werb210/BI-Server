import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const sendMock = vi.fn();
vi.mock("../../db", ()=>({ pool:{ query:(...args:unknown[])=>queryMock(...args) } }));
vi.mock("../../integrations/microsoftGraph", ()=>({ sendViaGraph:(...args:unknown[])=>sendMock(...args) }));
import { runSequenceSendWorkerTick } from "../sequenceSendWorker";

describe('sequence worker quota', ()=>{
  beforeEach(()=>{ queryMock.mockReset(); sendMock.mockReset(); });
  it('pushes when quota exceeded', async()=>{
    queryMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({rows:[{id:'e1',current_step:0,sequence_id:'s1',enrolled_by_user_id:'u1',contact_id:'c1'}]})
      .mockResolvedValueOnce({rows:[{step_number:1,subject:'Hi',body_template:'x',delay_days:0}]})
      .mockResolvedValueOnce({rows:[{sent_today:50,daily_limit:50}]})
      .mockResolvedValueOnce({});
    await runSequenceSendWorkerTick();
    expect(sendMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some(c=>String(c[0]).includes("INTERVAL '1 hour'"))).toBe(true);
  });
});
