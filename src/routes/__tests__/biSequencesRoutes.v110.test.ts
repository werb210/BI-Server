import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));
import router from "../biSequencesRoutes";

function app() { const a=express(); a.use(express.json()); a.use((req:any,_res,next)=>{req.user={id:'u1'};next();}); a.use(router); return a; }

describe('bi sequences v110', ()=>{
  beforeEach(()=>queryMock.mockReset());
  it('creates sequence', async()=>{
    queryMock.mockResolvedValueOnce({rows:[{id:'s1',name:'X'}]});
    const r = await request(app()).post('/sequences').send({name:'X'});
    expect(r.status).toBe(201);
    expect(r.body.sequence.id).toBe('s1');
  });
  it('enroll skips disqualified', async()=>{
    queryMock
      .mockResolvedValueOnce({rows:[{id:'c1',outreach_stage:'disqualified'}]})
      .mockResolvedValueOnce({rows:[{id:'c2',outreach_stage:'new'}]})
      .mockResolvedValueOnce({rowCount:1})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const r= await request(app()).post('/sequences/s1/enroll').send({contact_ids:['c1','c2']});
    expect(r.status).toBe(200);
    expect(r.body.results[0].status).toBe('skipped');
    expect(r.body.results[1].status).toBe('enrolled');
  });
});
