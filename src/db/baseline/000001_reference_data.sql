--
-- PostgreSQL database dump
--

\restrict 6O5aluPdzvlRouPDIpVErLwwjnNLaUhvEiDt49gjgwuTkZd1Mzt9CvGLroTvicx

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: bi_carrier_products; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bi_carrier_products VALUES ('3a3d0d10-5dfe-4103-900d-1cb46cfb4905', 'cgl', 'CA', 'Markel Canada', 'Commercial General Liability', 'Occurrence or claims-made. Limited pollution (120hr), non-owned auto.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('6b14f8a3-ede1-4408-8f34-44e90b57f49b', 'surety_bid', 'CA', 'Allianz Trade', 'Contract Surety - Bid Bond', 'CCDC 220. Broker submission, not instant.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('fdb3e14d-fe0f-4979-a767-ea1d968df075', 'surety_performance', 'CA', 'Allianz Trade', 'Contract Surety - Performance Bond', 'CCDC 221.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('8d77ea21-e708-4d8d-9e8c-ad6733484101', 'surety_payment', 'CA', 'Allianz Trade', 'Contract Surety - Labour & Material Payment Bond', 'CCDC 222.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('8b3dbee2-3ef1-47fc-b808-fe05f9ba3f1f', 'surety_maintenance', 'CA', 'Allianz Trade', 'Contract Surety - Maintenance Bond', 'Warranty-period defects.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('78ede73f-f3d8-4df3-827f-ec7c4594af2d', 'commercial_surety', 'CA', 'Allianz Trade', 'Commercial Surety - Licence and Permit Bonds', 'Regulated trades.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('9e1299fe-647b-4938-84b5-e88de40823bb', 'do', 'CA', 'CFC', 'Management Liability (D&O)', 'D&O + EPL + crime + executive reputation.', true, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('b7c4366e-ffe0-4fb5-be17-c4e740da20f3', 'do', 'CA', 'Markel Canada', 'Management Liability (D&O)', '', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('cedf9c56-0de7-4c85-8260-f7efc9158ddd', 'eo', 'CA', 'CFC', 'Contractor E&O', 'E&O + cyber + pollution + professional, with rectification cost cover. From $500.', true, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('6ed41f46-3a17-4a9a-bd1a-194b783aca5f', 'eo', 'CA', 'Markel Canada', 'Professional Liability (E&O)', 'Claims-made. Architects, engineers, design-build.', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('c7912a0c-ebba-464d-979e-fa423b137599', 'cpl', 'CA', 'Markel Canada', 'Contractors Pollution Liability (CPL)', 'Capacity to $25M, min premium $1,000. CPL Portal binds online.', true, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('e8b0268e-02ad-4cad-b4e8-145c81f1ed02', 'cpl', 'CA', 'CFC', 'Pollution Liability - Contractors', 'Standalone. Confirm wording with CFC.', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('ca72eaa1-65d7-4c45-8ada-edd6d28b2fba', 'cpl', 'CA', 'TerrAssure', 'Contractors Pollution Liability', 'Canada only. Limits, paper and minimum premium unpublished.', false, NULL, NULL, false, true, 30, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('5f532b0b-a705-484a-809c-5c19456d46d4', 'ppl', 'CA', 'Markel Canada', 'Premises Pollution Liability (PPL)', 'Includes storage tank liability.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('5d8bb4f6-3b51-4d12-8067-cc6e4c21d2f3', 'ppl', 'CA', 'CFC', 'Pollution Liability - Site', 'Standalone.', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('6d7526fd-8e1b-469a-89e6-2e39434654c9', 'ppl', 'CA', 'TerrAssure', 'Site Pollution', 'Canada only.', false, NULL, NULL, false, true, 30, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('87193263-440b-45ed-b70d-d6c2030a8697', 'cyber', 'CA', 'CFC', 'Cyber', 'Connect portal and API partners.', true, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('9c84a503-f807-4e38-9953-b8c99ea91203', 'cyber', 'CA', 'Markel Canada', 'Cyber 360 Canada', 'Flagship primary cyber.', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('164adced-4e35-4b02-bf54-1b1eeeffbddc', 'umbrella', 'CA', 'Markel Canada', 'Umbrella & Excess Liability', 'Over primary.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('8cde1709-20ee-40dd-ab26-79bf5d0fbbee', 'property_package', 'CA', 'Markel Canada', 'Property & Casualty package', 'Property, liability, BI, contents, inland marine.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('f610ff93-1ee5-4970-9552-21a9d0870eca', 'property_package', 'CA', 'CFC', 'Property and Casualty', '', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('6a6a4a2b-8958-46c5-9b36-558e8e59cf03', 'product_recall', 'CA', 'CFC', 'Product Recall', 'Food and beverage, consumer goods, automotive.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('985a0f09-2db5-4ad8-8936-21f789c36dde', 'transactional', 'CA', 'CFC', 'Transaction Liability', 'Reps and warranties. Offer and acceptance, not instant.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('bf7b1950-b2fd-43c0-8fa0-23fc35884b2f', 'trade_credit', 'CA', 'Allianz Trade', 'Trade Credit Insurance', 'Simplicity, Medium & Large, Multinational. Up to 95% indemnity.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('70eadc87-db16-4e08-a24e-6e9a7a826806', 'cgl', 'US', 'Markel US', 'Primary Casualty - contractors and developers', 'Practice policy, project-specific, owners interest, OCP.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('e10ceb4f-349b-4440-bab3-fc9ee412804f', 'contractor_equipment', 'US', 'Markel US', 'Contractors'' Equipment (inland marine)', 'Also misc. property floaters and motor truck cargo.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('cbf01704-5229-449b-b179-c2c439bfa91c', 'surety_bid', 'US', 'Markel Surety', 'Contract Bonds', 'Capacity to $500M, all 50 states. Primes and subs.', true, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('8ae5ff22-9a09-427d-819c-0322dde93d3f', 'surety_bid', 'US', 'Allianz Trade', 'Contract Surety - Bid, Performance, Payment, Warranty', 'AIA A310/A312. Miller Act over $150,000.', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('5b5bdab0-f184-40ea-b0d8-8e8847cf4d50', 'surety_performance', 'US', 'Markel Surety', 'Contract Bonds', 'Capacity to $500M.', true, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('ee5afb70-4b0c-4009-ad6a-c5df6cd037cc', 'surety_performance', 'US', 'Allianz Trade', 'Contract Surety - Bid, Performance, Payment, Warranty', '', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('253fb260-6b52-47e5-947f-5426aeb3334e', 'surety_payment', 'US', 'Markel Surety', 'Contract Bonds', '', true, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('6e89766f-3af0-4319-8894-118e31442608', 'surety_payment', 'US', 'Allianz Trade', 'Contract Surety - Bid, Performance, Payment, Warranty', '', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('dedd001e-3dcc-46c5-b169-8878f8356db0', 'commercial_surety', 'US', 'Markel Surety', 'Commercial Bonds', 'Instant issuance on Surety Connect.', true, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('d3b6b74f-3c68-4c16-a446-082918cf5f46', 'commercial_surety', 'US', 'Allianz Trade', 'Commercial Surety', 'Licence and permit, court, compliance.', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('5bc55236-7d2e-41bb-bd81-b527e4b03cef', 'do', 'US', 'CFC', 'Management Liability (D&O)', '', true, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('ca43f0e7-ad80-4bc3-9107-c94f4e7eb8cc', 'eo', 'US', 'CFC', 'E&O for design and construction contractors', 'US wording, distinct from the Canadian Contractor E&O.', true, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('0125df05-385e-467b-a484-51c76e8b050e', 'cpl', 'US', 'Markel US', 'Environmental', 'Broad appetite.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('ce8c2e47-4c01-4840-aa4f-9ab9b84bd46f', 'cpl', 'US', 'CFC', 'Pollution Liability - Contractors / Site', '', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('4e5c4a93-c92c-4cdc-8e64-3e9fbf270f32', 'ppl', 'US', 'Markel US', 'Environmental', '', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('c19d6980-a796-4b34-8227-ad628ea15327', 'ppl', 'US', 'CFC', 'Pollution Liability - Contractors / Site', '', false, NULL, NULL, false, true, 20, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('2a3f0029-0eda-42a4-ae33-db3a901943e7', 'cyber', 'US', 'CFC', 'Cyber', 'Construction: wire transfer fraud, supply chain interruption.', true, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('56a52c25-ea42-4fd8-b3c0-1e57fe6193f0', 'builders_risk', 'US', 'Markel US', 'Large Builders Risk', 'Project-specific and master programmes.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('116bf6f4-26f6-4c14-a155-cc10590aa3b7', 'umbrella', 'US', 'Markel US', 'Excess and Umbrella', '', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('ac52ce1c-f963-4788-bdd4-e707ec2fb0a4', 'property_package', 'US', 'Markel US', 'Small Business Casualty and Property', 'Contractor bundles.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('6a30155c-7b3b-41f1-a026-887cf9ea3140', 'product_recall', 'US', 'CFC', 'Product Recall', '', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('819e243f-4180-491f-b3e3-1645222904b2', 'transactional', 'US', 'CFC', 'Transaction Liability', 'Offer and acceptance.', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_carrier_products VALUES ('9c292e86-6dc7-450c-b34a-1c88a6479263', 'trade_credit', 'US', 'Allianz Trade', 'Trade Credit Insurance', '', false, NULL, NULL, false, true, 10, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');


--
-- Data for Name: bi_coverage_labels; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bi_coverage_labels VALUES ('cgl', 'Commercial General Liability', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('cpl', 'Contractors Pollution Liability', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('builders_risk', 'Builder''s Risk (Course of Construction)', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('contractor_equipment', 'Contractors Equipment', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('eo', 'Professional Liability (Errors and Omissions)', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('cyber', 'Cyber Liability', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('do', 'Management Liability (D&O)', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('surety_bid', 'Contract Surety - Bid Bond', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('surety_performance', 'Contract Surety - Performance Bond', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('surety_payment', 'Contract Surety - Labour and Material Payment Bond', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('surety_maintenance', 'Contract Surety - Maintenance Bond', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('pgi', 'Personal Guarantee Insurance', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('trade_credit', 'Trade Credit Insurance', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('transactional', 'Transaction Liability', '2026-08-10 17:07:56.903335+00');
INSERT INTO public.bi_coverage_labels VALUES ('workers_comp', 'Workers Compensation', '2026-08-11 15:57:13.716706+00');
INSERT INTO public.bi_coverage_labels VALUES ('auto_liability', 'Automobile Liability', '2026-08-11 15:57:13.716706+00');


--
-- Data for Name: bi_questions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bi_questions VALUES ('section_1_a', 'Does the business carry insurance coverage for all physical assets covered by the personal guarantee?', NULL, 'yes_no', 'declarations', NULL, true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('section_1_2', 'Have you ever declared personal bankruptcy?', NULL, 'yes_no', 'declarations', 'yes', true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('section_2_a', 'Have you ever been barred from serving as a Director, or are you currently under investigation that could result in being barred?', NULL, 'yes_no', 'declarations', 'yes', true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('section_2_b', 'Have you ever been a Director of a company that has gone through bankruptcy, receivership, or restructuring proceedings?', NULL, 'yes_no', 'declarations', 'yes', true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('section_2_c', 'Have you ever been a Director of a company that has been under investigation by the Canada Revenue Agency or the Canada Border Services Agency?', NULL, 'yes_no', 'declarations', 'yes', true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('section_2_c_us', 'Have you ever been a Director of a company that has been under investigation by the Internal Revenue Service or U.S. Customs and Border Protection?', NULL, 'yes_no', 'declarations', 'yes', true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('section_2_d', 'Do you currently have any actual or contingent liability that you will not be able to pay within 30 days of when it becomes due?', NULL, 'yes_no', 'declarations', 'yes', true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('section_3_a', 'Does the business currently have any bad or doubtful debts owed to it that are likely to materially affect its ability to pay liabilities as they become due?', NULL, 'yes_no', 'declarations', 'yes', true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('section_4_a', 'Has the business lost a significant investor, customer, or supplier in the last 6 months?', NULL, 'yes_no', 'declarations', 'yes', true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('section_5_a', 'Are you aware of any information that could materially affect the business''s ability to meet its obligations over the next 6 months?', NULL, 'yes_no', 'declarations', 'yes', true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('section_6_a', 'As of today, is the company solvent (able to pay its debts as they become due)?', NULL, 'yes_no', 'declarations', NULL, true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('section_3_c', 'I confirm that all answers above are true to the best of my knowledge. If anyone else completed this form on my behalf, I confirm they were authorized to do so and that their answers are accurate.', NULL, 'agree_disagree', 'declarations', 'Disagree', true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('electronic_signature', 'Do you consent to electronic signatures?', NULL, 'yes_no', 'consents', NULL, true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('no_undisclosed_events', 'Do you certify there are no undisclosed adverse events?', NULL, 'yes_no', 'consents', NULL, true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('data_use', 'Do you consent to our use of your data for underwriting?', NULL, 'yes_no', 'consents', NULL, true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('credit_pull', 'Do you authorize us to pull your credit report?', NULL, 'yes_no', 'consents', NULL, true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('coverage_understood', 'Do you understand what PGI covers and does not cover?', NULL, 'yes_no', 'consents', NULL, true, NULL, NULL, '2026-08-10 15:23:30.999423+00', '2026-08-10 15:23:30.999423+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('guarantor_dob', 'What is your date of birth?', NULL, 'date', 'guarantor', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('guarantor_addr_line1', 'Primary residential address', NULL, 'text', 'guarantor', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, '123 King Street West');
INSERT INTO public.bi_questions VALUES ('guarantor_addr_city', 'City', NULL, 'text', 'guarantor', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('guarantor_addr_region', 'Province or state', NULL, 'text', 'guarantor', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('guarantor_addr_postal', 'Postal or ZIP code', NULL, 'text', 'guarantor', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, 'A1A 1A1');
INSERT INTO public.bi_questions VALUES ('q_ca_id_type', 'Government ID type', 'As shown on your photo ID. Used for identity checks by the carrier.', 'select', 'guarantor', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', '["Passport", "National ID", "Driving Licence", "Other"]', NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('q_ca_id_number', 'Government ID number', 'The number on that document.', 'text', 'guarantor', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, 'Exactly as shown on the document');
INSERT INTO public.bi_questions VALUES ('has_co_guarantors', 'Is anyone else guaranteeing this loan with you?', 'If yes, we will collect their details with you directly.', 'yes_no', 'guarantor', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('entity_type', 'What type of entity is the business?', NULL, 'select', 'business', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', '["Corporation", "Partnership", "Sole Proprietorship", "LLC", "Other"]', NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('business_addr_line1', 'Business operating address', NULL, 'text', 'business', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, '123 King Street West');
INSERT INTO public.bi_questions VALUES ('business_addr_city', 'Business city', NULL, 'text', 'business', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('business_addr_region', 'Business province or state', 'Quebec is not eligible for this coverage.', 'text', 'business', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('business_addr_postal', 'Business postal or ZIP code', NULL, 'text', 'business', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, 'A1A 1A1');
INSERT INTO public.bi_questions VALUES ('business_number', 'Business number', NULL, 'text', 'business', NULL, false, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, '123456789RT0001');
INSERT INTO public.bi_questions VALUES ('business_website', 'Business website', NULL, 'text', 'business', NULL, false, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, 'optional');
INSERT INTO public.bi_questions VALUES ('lender_name', 'Who is the lender?', NULL, 'text', 'loan', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('q_ca_loan_type', 'What type of loan is this?', 'Only commercial mortgages and other secured loans are eligible.', 'select', 'loan', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', '["Commercial Mortgage", "Other Secured Loan"]', NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('loan_amount', 'How much is the loan?', 'Between $50,000 and $1,000,000.', 'number', 'loan', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, 50000.00, 1000000.00, NULL);
INSERT INTO public.bi_questions VALUES ('pgi_limit', 'How much cover do you need?', 'Cannot be more than 80% of the loan amount.', 'number', 'loan', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, 1000000.00, NULL);
INSERT INTO public.bi_questions VALUES ('loan_funding_date', 'What is the loan funding date?', NULL, 'date', 'loan', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('policy_start_date', 'What date do you need the policy to start?', NULL, 'date', 'loan', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('loan_purpose', 'What is the purpose of the loan?', 'For our records. It does not affect eligibility.', 'select', 'loan', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', '["Working Capital", "Acquisition", "Expansion", "Equipment Purchase", "Real Estate", "Refinance", "Other"]', NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('csbfp_backed', 'Is the loan backed by the Canada Small Business Financing Program?', NULL, 'yes_no', 'loan', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('loan_has_guaranteed_cap', 'Does the guarantee have a capped amount?', NULL, 'yes_no', 'loan', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('personally_guaranteeing', 'Are you personally guaranteeing this loan?', NULL, 'yes_no', 'loan', NULL, true, NULL, NULL, '2026-08-10 18:09:41.180791+00', '2026-08-10 18:09:41.180791+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('sba_backed', 'Is the loan backed by the U.S. Small Business Administration?', 'For example a 7(a) or 504 loan.', 'yes_no', 'loan', NULL, true, NULL, NULL, '2026-08-10 18:14:52.307016+00', '2026-08-10 18:14:52.307016+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('formation_date', 'When was the business formed?', 'The date on your incorporation or registration record.', 'date', 'business', NULL, true, NULL, NULL, '2026-08-11 16:24:11.684143+00', '2026-08-11 16:24:11.684143+00', NULL, NULL, NULL, NULL);
INSERT INTO public.bi_questions VALUES ('naics_code', 'Industry code', 'We have filled this in from the industry you chose. Change it only if you know your own code.', 'text', 'business', NULL, false, NULL, NULL, '2026-08-11 16:24:11.684143+00', '2026-08-11 16:24:11.684143+00', NULL, NULL, NULL, '6 digits');


--
-- Data for Name: bi_coverage_questions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_1_a', 'CA', 1010);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_1_2', 'CA', 1020);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_2_a', 'CA', 1030);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_2_b', 'CA', 1040);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_2_c', 'CA', 1050);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_2_d', 'CA', 1060);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_3_a', 'CA', 1070);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_4_a', 'CA', 1080);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_5_a', 'CA', 1090);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_6_a', 'CA', 1100);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_3_c', 'CA', 1110);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'electronic_signature', 'CA', 1200);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'no_undisclosed_events', 'CA', 1210);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'data_use', 'CA', 1220);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'credit_pull', 'CA', 1230);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'coverage_understood', 'CA', 1240);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_1_a', 'US', 1010);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_1_2', 'US', 1020);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_2_a', 'US', 1030);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_2_b', 'US', 1040);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_2_c_us', 'US', 1050);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_2_d', 'US', 1060);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_3_a', 'US', 1070);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_4_a', 'US', 1080);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_5_a', 'US', 1090);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_6_a', 'US', 1100);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'section_3_c', 'US', 1110);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'electronic_signature', 'US', 1200);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'no_undisclosed_events', 'US', 1210);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'data_use', 'US', 1220);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'credit_pull', 'US', 1230);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'coverage_understood', 'US', 1240);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'guarantor_dob', 'CA', 110);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'guarantor_dob', 'US', 110);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'guarantor_addr_line1', 'CA', 120);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'guarantor_addr_line1', 'US', 120);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'guarantor_addr_city', 'CA', 130);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'guarantor_addr_city', 'US', 130);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'guarantor_addr_region', 'CA', 140);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'guarantor_addr_region', 'US', 140);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'guarantor_addr_postal', 'CA', 150);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'guarantor_addr_postal', 'US', 150);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'q_ca_id_type', 'CA', 160);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'q_ca_id_type', 'US', 160);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'q_ca_id_number', 'CA', 170);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'q_ca_id_number', 'US', 170);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'has_co_guarantors', 'CA', 180);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'has_co_guarantors', 'US', 180);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'entity_type', 'CA', 210);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'entity_type', 'US', 210);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_addr_line1', 'CA', 220);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_addr_line1', 'US', 220);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_addr_city', 'CA', 230);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_addr_city', 'US', 230);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_addr_region', 'CA', 240);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_addr_region', 'US', 240);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_addr_postal', 'CA', 250);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_addr_postal', 'US', 250);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_number', 'CA', 260);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_number', 'US', 260);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_website', 'CA', 270);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'business_website', 'US', 270);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'lender_name', 'CA', 310);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'lender_name', 'US', 310);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'q_ca_loan_type', 'CA', 320);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'q_ca_loan_type', 'US', 320);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'loan_amount', 'CA', 330);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'loan_amount', 'US', 330);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'pgi_limit', 'CA', 340);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'pgi_limit', 'US', 340);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'loan_funding_date', 'CA', 350);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'loan_funding_date', 'US', 350);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'policy_start_date', 'CA', 360);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'policy_start_date', 'US', 360);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'loan_purpose', 'CA', 370);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'loan_purpose', 'US', 370);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'csbfp_backed', 'CA', 380);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'loan_has_guaranteed_cap', 'CA', 390);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'loan_has_guaranteed_cap', 'US', 390);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'personally_guaranteeing', 'CA', 400);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'personally_guaranteeing', 'US', 400);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'sba_backed', 'US', 380);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'formation_date', 'CA', 115);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'naics_code', 'CA', 116);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'formation_date', 'US', 115);
INSERT INTO public.bi_coverage_questions VALUES ('pgi', 'naics_code', 'US', 116);


--
-- Data for Name: bi_industries; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bi_industries VALUES ('construction', 'Construction and trades', '236220', true, 10, true, '2026-08-11 16:24:11.684143+00');
INSERT INTO public.bi_industries VALUES ('manufacturing', 'Manufacturing and distribution', '332999', false, 20, true, '2026-08-11 16:24:11.684143+00');
INSERT INTO public.bi_industries VALUES ('technology', 'Technology, media and telecom', '541510', false, 30, true, '2026-08-11 16:24:11.684143+00');
INSERT INTO public.bi_industries VALUES ('professional_services', 'Professional services', '541611', false, 40, true, '2026-08-11 16:24:11.684143+00');
INSERT INTO public.bi_industries VALUES ('healthcare', 'Healthcare and life sciences', '621111', false, 50, true, '2026-08-11 16:24:11.684143+00');
INSERT INTO public.bi_industries VALUES ('real_estate', 'Real estate and property', '531120', false, 60, true, '2026-08-11 16:24:11.684143+00');
INSERT INTO public.bi_industries VALUES ('retail_food', 'Retail, wholesale, food and beverage', '445110', false, 70, true, '2026-08-11 16:24:11.684143+00');
INSERT INTO public.bi_industries VALUES ('nonprofit', 'Non-profit, social and care', '813410', false, 80, true, '2026-08-11 16:24:11.684143+00');
INSERT INTO public.bi_industries VALUES ('sport_recreation', 'Sport, recreation and fitness', '713940', false, 90, true, '2026-08-11 16:24:11.684143+00');
INSERT INTO public.bi_industries VALUES ('other', 'Something else', '561990', false, 999, true, '2026-08-11 16:24:11.684143+00');
INSERT INTO public.bi_industries VALUES ('financial', 'Financial institutions and fintech', '522390', false, 65, true, '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_industries VALUES ('energy', 'Energy, oil and gas', '213112', false, 75, true, '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_industries VALUES ('transportation', 'Transportation, logistics and marine', '488510', false, 85, true, '2026-09-26 20:33:09.531127+00');


--
-- Data for Name: bi_industry_coverages; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bi_industry_coverages VALUES ('manufacturing', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('manufacturing', 'trade_credit', 10);
INSERT INTO public.bi_industry_coverages VALUES ('manufacturing', 'cgl', 20);
INSERT INTO public.bi_industry_coverages VALUES ('manufacturing', 'eo', 30);
INSERT INTO public.bi_industry_coverages VALUES ('manufacturing', 'cpl', 40);
INSERT INTO public.bi_industry_coverages VALUES ('manufacturing', 'cyber', 50);
INSERT INTO public.bi_industry_coverages VALUES ('manufacturing', 'do', 60);
INSERT INTO public.bi_industry_coverages VALUES ('technology', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('technology', 'eo', 10);
INSERT INTO public.bi_industry_coverages VALUES ('technology', 'cyber', 20);
INSERT INTO public.bi_industry_coverages VALUES ('technology', 'do', 30);
INSERT INTO public.bi_industry_coverages VALUES ('professional_services', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('professional_services', 'eo', 10);
INSERT INTO public.bi_industry_coverages VALUES ('professional_services', 'cyber', 20);
INSERT INTO public.bi_industry_coverages VALUES ('professional_services', 'do', 30);
INSERT INTO public.bi_industry_coverages VALUES ('professional_services', 'cgl', 40);
INSERT INTO public.bi_industry_coverages VALUES ('healthcare', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('healthcare', 'eo', 10);
INSERT INTO public.bi_industry_coverages VALUES ('healthcare', 'cyber', 20);
INSERT INTO public.bi_industry_coverages VALUES ('healthcare', 'cgl', 30);
INSERT INTO public.bi_industry_coverages VALUES ('healthcare', 'do', 40);
INSERT INTO public.bi_industry_coverages VALUES ('real_estate', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('real_estate', 'cgl', 10);
INSERT INTO public.bi_industry_coverages VALUES ('real_estate', 'cpl', 20);
INSERT INTO public.bi_industry_coverages VALUES ('real_estate', 'do', 30);
INSERT INTO public.bi_industry_coverages VALUES ('real_estate', 'cyber', 40);
INSERT INTO public.bi_industry_coverages VALUES ('retail_food', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('retail_food', 'trade_credit', 10);
INSERT INTO public.bi_industry_coverages VALUES ('retail_food', 'cgl', 20);
INSERT INTO public.bi_industry_coverages VALUES ('retail_food', 'cyber', 30);
INSERT INTO public.bi_industry_coverages VALUES ('retail_food', 'do', 40);
INSERT INTO public.bi_industry_coverages VALUES ('nonprofit', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('nonprofit', 'cgl', 10);
INSERT INTO public.bi_industry_coverages VALUES ('nonprofit', 'do', 20);
INSERT INTO public.bi_industry_coverages VALUES ('nonprofit', 'cyber', 30);
INSERT INTO public.bi_industry_coverages VALUES ('sport_recreation', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('sport_recreation', 'cgl', 10);
INSERT INTO public.bi_industry_coverages VALUES ('sport_recreation', 'do', 20);
INSERT INTO public.bi_industry_coverages VALUES ('other', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('other', 'cgl', 10);
INSERT INTO public.bi_industry_coverages VALUES ('other', 'eo', 20);
INSERT INTO public.bi_industry_coverages VALUES ('other', 'cyber', 30);
INSERT INTO public.bi_industry_coverages VALUES ('other', 'do', 40);
INSERT INTO public.bi_industry_coverages VALUES ('financial', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('financial', 'eo', 10);
INSERT INTO public.bi_industry_coverages VALUES ('financial', 'do', 20);
INSERT INTO public.bi_industry_coverages VALUES ('financial', 'cyber', 30);
INSERT INTO public.bi_industry_coverages VALUES ('financial', 'transactional', 40);
INSERT INTO public.bi_industry_coverages VALUES ('energy', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('energy', 'cgl', 10);
INSERT INTO public.bi_industry_coverages VALUES ('energy', 'cpl', 20);
INSERT INTO public.bi_industry_coverages VALUES ('energy', 'eo', 30);
INSERT INTO public.bi_industry_coverages VALUES ('energy', 'do', 40);
INSERT INTO public.bi_industry_coverages VALUES ('transportation', 'pgi', 5);
INSERT INTO public.bi_industry_coverages VALUES ('transportation', 'trade_credit', 10);
INSERT INTO public.bi_industry_coverages VALUES ('transportation', 'cgl', 20);
INSERT INTO public.bi_industry_coverages VALUES ('transportation', 'cyber', 30);
INSERT INTO public.bi_industry_coverages VALUES ('transportation', 'do', 40);


--
-- Data for Name: bi_outreach_stages; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bi_outreach_stages VALUES ('new', 'New', 1, false, false, '#9ca3af', '2026-05-22 15:15:48.140872+00');
INSERT INTO public.bi_outreach_stages VALUES ('queued', 'Queued', 2, false, false, '#60a5fa', '2026-05-22 15:15:48.140872+00');
INSERT INTO public.bi_outreach_stages VALUES ('contacted', 'Contacted', 3, false, false, '#38bdf8', '2026-05-22 15:15:48.140872+00');
INSERT INTO public.bi_outreach_stages VALUES ('engaged', 'Engaged', 4, false, false, '#a78bfa', '2026-05-22 15:15:48.140872+00');
INSERT INTO public.bi_outreach_stages VALUES ('meeting_booked', 'Meeting booked', 5, false, false, '#f59e0b', '2026-05-22 15:15:48.140872+00');
INSERT INTO public.bi_outreach_stages VALUES ('qualified', 'Qualified', 6, false, false, '#10b981', '2026-05-22 15:15:48.140872+00');
INSERT INTO public.bi_outreach_stages VALUES ('nurture', 'Nurture', 7, false, false, '#f97316', '2026-05-22 15:15:48.140872+00');
INSERT INTO public.bi_outreach_stages VALUES ('disqualified', 'Disqualified', 8, true, true, '#6b7280', '2026-05-22 15:15:48.140872+00');


--
-- Data for Name: bi_products; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bi_products VALUES ('26f77571-a031-4f27-b937-ddbedcfd658e', 'cgl', 'Commercial General Liability', 'Markel Canada', 'CA', 'liability', 'construction', 1, true, 'Third-party injury or property damage on site.', 10, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('353a9674-7991-4dbc-be58-b8ac258966b0', 'cgl', 'Commercial General Liability', 'Markel US', 'US', 'liability', 'construction', 1, true, 'Third-party injury or property damage on site.', 10, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('27045ab3-2bf1-4437-8442-437cb94496c7', 'contractor_equipment', 'Contractors Equipment (Inland Marine)', 'Markel US', 'US', 'property', 'construction', 1, true, 'Theft or damage to tools and plant.', 20, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('8b51efdc-6869-4f73-aaff-ce4be4be5313', 'surety_bid', 'Contract Surety - Bid Bond', 'Allianz Trade', 'CA', 'surety', 'construction', 1, false, 'CCDC 220. Guarantees you will enter the contract if awarded.', 30, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('8a2eb208-fdb8-40c7-9064-339690a0fd66', 'surety_bid', 'Contract Surety - Bid Bond', 'Markel Surety', 'US', 'surety', 'construction', 1, true, 'AIA A310. Instant issuance available.', 30, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('867c4396-d114-46c9-90fb-ee058e08aced', 'surety_performance', 'Contract Surety - Performance Bond', 'Allianz Trade', 'CA', 'surety', 'construction', 1, false, 'CCDC 221. Guarantees completion of the work.', 31, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('ddecc1e0-a6b3-4a29-b4a5-d30f639b4554', 'surety_performance', 'Contract Surety - Performance Bond', 'Markel Surety', 'US', 'surety', 'construction', 1, true, 'AIA A312. Miller Act applies to federal work over $150,000.', 31, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('5742ec96-64a5-400b-ac1d-38ce3631efd4', 'surety_payment', 'Contract Surety - Labour and Material Payment Bond', 'Allianz Trade', 'CA', 'surety', 'construction', 1, false, 'CCDC 222. Guarantees your subcontractors and suppliers are paid.', 32, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('035a7d43-a3c8-4fde-84dd-6739ca885a2f', 'surety_payment', 'Contract Surety - Labour and Material Payment Bond', 'Markel Surety', 'US', 'surety', 'construction', 1, true, 'AIA A312 payment bond.', 32, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('c03ead50-6306-4bca-8aca-dbb6eb9e9477', 'surety_maintenance', 'Contract Surety - Maintenance Bond', 'Allianz Trade', 'CA', 'surety', 'construction', 1, false, 'Covers defects during the warranty period.', 33, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('5f4c8aa3-0ca3-4822-9432-6b640450e2e4', 'do', 'Management Liability (D&O)', 'CFC', 'CA', 'financial_lines', 'construction', 2, true, 'Claims against the individuals running the company.', 40, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('272933b8-e21c-4d03-81ff-5e687004feee', 'do', 'Management Liability (D&O)', 'CFC', 'US', 'financial_lines', 'construction', 2, true, 'Claims against the individuals running the company.', 40, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('38d1b125-29bb-4622-aa43-c49825ecba87', 'eo', 'Contractor E&O', 'CFC', 'CA', 'professional', 'construction', 2, true, 'Errors and omissions, with cyber, pollution and rectification cost cover. From $500.', 50, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('3cbd8ee1-0074-431f-b501-f55066c25f04', 'eo', 'E&O for Design and Construction Contractors', 'CFC', 'US', 'professional', 'construction', 2, true, 'Errors and omissions for US design-build contractors.', 50, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('c374cb61-141a-4f25-8d9c-0dd5b4e5f342', 'cpl', 'Contractors Pollution Liability', 'Markel Canada', 'CA', 'environmental', 'construction', 2, true, 'Picks up where CGL leaves off: mould, asbestos, fuel spills. Capacity to $25M.', 60, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('7685cc1e-19e1-4dde-a793-4a26120c1dce', 'cpl', 'Contractors Pollution Liability', 'Markel US', 'US', 'environmental', 'construction', 2, true, 'Picks up where CGL leaves off: mould, asbestos, fuel spills.', 60, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('64a8fb60-637c-4c31-9bc1-ba2a0abb3b37', 'cyber', 'Cyber', 'CFC', 'CA', 'cyber', 'construction', 2, true, 'Wire transfer fraud, ransomware, supply chain interruption.', 80, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('58075019-917e-4a7c-a6ba-9c54c41f51bb', 'cyber', 'Cyber', 'CFC', 'US', 'cyber', 'construction', 2, true, 'Wire transfer fraud, ransomware, supply chain interruption.', 80, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('5910c099-62f2-4be0-9e5b-b931c743c7fc', 'builders_risk', 'Large Builders Risk', 'Markel US', 'US', 'property', 'construction', 2, false, 'Course of construction physical damage and business interruption.', 90, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('733e8871-f309-4643-9b3c-9574129a3eb8', 'transactional', 'Transaction Liability', 'CFC', 'CA', 'specialty', 'construction', 3, false, 'Breach of reps and warranties on a sale. Offer and acceptance.', 100, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('95f1ea80-6f97-4a8f-8bab-5537ea2a72e8', 'transactional', 'Transaction Liability', 'CFC', 'US', 'specialty', 'construction', 3, false, 'Breach of reps and warranties on a sale. Offer and acceptance.', 100, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('8f55a1a8-24dd-444c-8ef1-086bd0a50a65', 'trade_credit', 'Trade Credit Insurance', 'Allianz Trade', 'CA', 'credit', 'construction', 3, false, 'Protects receivables against customer insolvency.', 110, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('84068b79-3dbf-4994-93cf-9f6743052f37', 'trade_credit', 'Trade Credit Insurance', 'Allianz Trade', 'US', 'credit', 'construction', 3, false, 'Protects receivables against customer insolvency.', 110, true, '2026-08-01 19:28:15.672321+00', '2026-08-01 19:28:15.672321+00');
INSERT INTO public.bi_products VALUES ('c023587b-5d60-4d0e-bf97-8faad2cfe91f', 'pgi', 'Personal Guarantee Insurance', 'Boreal', 'CA', 'specialty', 'construction', 2, true, 'Covers enforcement of a personal guarantee or indemnity you have signed.', 5, true, '2026-08-01 19:28:15.672321+00', '2026-08-09 23:07:56.825752+00');
INSERT INTO public.bi_products VALUES ('60d43942-0dfa-43e0-86a6-f51396f9260b', 'pgi', 'Personal Guarantee Insurance', 'Boreal', 'US', 'specialty', 'construction', 2, true, 'Covers enforcement of a personal guarantee or indemnity you have signed.', 5, true, '2026-08-01 19:28:15.672321+00', '2026-08-09 23:07:56.825752+00');
INSERT INTO public.bi_products VALUES ('7dc03590-ef3e-4b58-bd96-969f6122044a', 'ppl', 'Site / Premises Pollution Liability', 'Markel Canada', 'CA', 'environmental', 'construction', 2, false, 'Pollution from a site you own or operate, including storage tanks.', 61, false, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_products VALUES ('ce36dc59-55d3-41df-a33b-f55364cd84ae', 'ppl', 'Site / Premises Pollution Liability', 'Markel US', 'US', 'environmental', 'construction', 2, false, 'Pollution from a site you own or operate.', 61, false, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_products VALUES ('87b2854a-0823-4d7f-aba4-1ed17d0182af', 'umbrella', 'Umbrella and Excess Liability', 'Markel Canada', 'CA', 'liability', 'construction', 2, false, 'Extra limits over your primary liability policies.', 15, false, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_products VALUES ('8f3138ab-ead0-4fa9-bbc5-662a4802c75c', 'umbrella', 'Umbrella and Excess Liability', 'Markel US', 'US', 'liability', 'construction', 2, false, 'Extra limits over your primary liability policies.', 15, false, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_products VALUES ('49067f68-1e4e-4d2e-a234-962ad1951036', 'property_package', 'Property and Casualty Package', 'Markel Canada', 'CA', 'property', 'construction', 2, false, 'Property, liability, business interruption and contents in one policy.', 25, false, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_products VALUES ('62ba7c1c-8f37-4d05-afb6-4b106e43f4d2', 'property_package', 'Property and Casualty Package', 'Markel US', 'US', 'property', 'construction', 2, false, 'Property and liability for small businesses.', 25, false, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_products VALUES ('3f26c3fd-b9bf-4aea-99b1-8b94a9359694', 'product_recall', 'Product Recall', 'CFC', 'CA', 'specialty', 'construction', 3, false, 'Costs of recalling a contaminated or defective product.', 105, false, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_products VALUES ('198e39f4-c8d4-4ee7-8f0d-7c5f9737f3b2', 'product_recall', 'Product Recall', 'CFC', 'US', 'specialty', 'construction', 3, false, 'Costs of recalling a contaminated or defective product.', 105, false, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_products VALUES ('4bc43bb1-2e14-4fc8-93bb-8248a4f6d8e2', 'commercial_surety', 'Commercial Surety - Licence and Permit Bonds', 'Allianz Trade', 'CA', 'surety', 'construction', 2, false, 'Bonds required to hold a licence or permit.', 34, false, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');
INSERT INTO public.bi_products VALUES ('25d6175a-417b-4fe5-934e-41332d3fa28e', 'commercial_surety', 'Commercial Surety - Licence and Permit Bonds', 'Markel Surety', 'US', 'surety', 'construction', 2, true, 'Bonds required to hold a licence or permit.', 34, false, '2026-09-26 20:33:09.531127+00', '2026-09-26 20:33:09.531127+00');


--
-- Data for Name: bi_required_doc_catalog; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bi_required_doc_catalog VALUES ('loan_agreement', 'Loan Agreement / Term Sheet', 'Lender agreement or term sheet. Required for Canadian (Purbeck) submissions.', false, 10, true, '2026-05-28 16:11:10.378446', '2026-05-28 16:11:10.378446', true);
INSERT INTO public.bi_required_doc_catalog VALUES ('annual_financials_3yr', '3 Years Accountant-Prepared Annual Financials', 'Accountant-prepared annual financial statements for the most recent 3 fiscal years. Upload one PDF per year.', false, 25, false, '2026-05-26 03:41:24.487917', '2026-05-28 22:32:04.06643', true);
INSERT INTO public.bi_required_doc_catalog VALUES ('profit_loss', 'Profit & Loss Statement', 'Optional financial document included in the Purbeck submission.', false, 20, true, '2026-05-04 20:42:47.329297', '2026-09-10 22:00:58.516502', false);
INSERT INTO public.bi_required_doc_catalog VALUES ('balance_sheet', 'Balance Sheet', 'Optional financial document included in the Purbeck submission.', false, 30, true, '2026-05-04 20:42:47.329297', '2026-09-10 22:00:58.516502', false);
INSERT INTO public.bi_required_doc_catalog VALUES ('ar_aging', 'Accounts Receivable Aging', 'Optional financial document included in the Purbeck submission.', false, 40, true, '2026-05-04 20:42:47.329297', '2026-09-10 22:00:58.516502', false);
INSERT INTO public.bi_required_doc_catalog VALUES ('ap_aging', 'Accounts Payable Aging', 'Optional financial document included in the Purbeck submission.', false, 50, true, '2026-05-04 20:42:47.329297', '2026-09-10 22:00:58.516502', false);
INSERT INTO public.bi_required_doc_catalog VALUES ('founder_cv', 'Founder CV / Resume', 'Optional supporting document included in the Purbeck submission.', false, 60, true, '2026-05-04 20:42:47.329297', '2026-09-10 22:00:58.516502', false);
INSERT INTO public.bi_required_doc_catalog VALUES ('financial_forecast', 'Financial Forecast', 'Optional financial document included in the Purbeck submission.', false, 70, true, '2026-05-04 20:42:47.329297', '2026-09-10 22:00:58.516502', false);


--
-- Data for Name: naics_codes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.naics_codes VALUES ('236110', 'CA', 'Residential building construction', 'New single-family + multi-family + remodeling', '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('236210', 'CA', 'Industrial building construction', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('236220', 'CA', 'Commercial and institutional building construction', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('238100', 'CA', 'Foundation, structure, and building exterior contractors', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('238210', 'CA', 'Electrical contractors and other wiring installation', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('238220', 'CA', 'Plumbing, heating and air-conditioning contractors', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('238910', 'CA', 'Site preparation contractors', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('441100', 'CA', 'Automobile dealers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('441200', 'CA', 'Other motor vehicle dealers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('441300', 'CA', 'Automotive parts, accessories and tire stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('445110', 'CA', 'Supermarkets and grocery stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('445120', 'CA', 'Convenience stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('445230', 'CA', 'Fruit and vegetable markets', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('445299', 'CA', 'All other specialty food stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('445310', 'CA', 'Beer, wine and liquor stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('446110', 'CA', 'Pharmacies and drug stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('448110', 'CA', 'Men''s clothing stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('448120', 'CA', 'Women''s clothing stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('448140', 'CA', 'Family clothing stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('451110', 'CA', 'Sporting goods stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('453110', 'CA', 'Florists', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('453910', 'CA', 'Pet and pet supplies stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('484110', 'CA', 'General freight trucking, local', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('484121', 'CA', 'General freight trucking, long distance, truckload', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('484229', 'CA', 'Other specialized trucking, local', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('492110', 'CA', 'Couriers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('492210', 'CA', 'Local messengers and local delivery', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('522110', 'CA', 'Banking', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('523930', 'CA', 'Investment advice', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('524210', 'CA', 'Insurance agencies and brokerages', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('531110', 'CA', 'Lessors of residential buildings and dwellings', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('531210', 'CA', 'Offices of real estate agents and brokers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('531311', 'CA', 'Residential property managers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541110', 'CA', 'Offices of lawyers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541211', 'CA', 'Offices of certified public accountants', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541310', 'CA', 'Architectural services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541330', 'CA', 'Engineering services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541430', 'CA', 'Graphic design services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541510', 'CA', 'Computer systems design and related services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541611', 'CA', 'Administrative management and general management consulting', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541810', 'CA', 'Advertising agencies', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541910', 'CA', 'Marketing research and public opinion polling', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('561320', 'CA', 'Temporary help services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('561720', 'CA', 'Janitorial services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('611110', 'CA', 'Elementary and secondary schools', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621111', 'CA', 'Offices of physicians (except mental health specialists)', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621210', 'CA', 'Offices of dentists', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621310', 'CA', 'Offices of chiropractors', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621320', 'CA', 'Offices of optometrists', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621399', 'CA', 'Offices of all other miscellaneous health practitioners', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621610', 'CA', 'Home health care services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('722410', 'CA', 'Drinking places (alcoholic beverages)', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('722511', 'CA', 'Full-service restaurants', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('722512', 'CA', 'Limited-service eating places', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('722513', 'CA', 'Limited-service eating places (counter service)', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('811111', 'CA', 'General automotive repair', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('811121', 'CA', 'Automotive body, paint and interior repair and maintenance', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('811210', 'CA', 'Electronic and precision equipment repair and maintenance', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('812114', 'CA', 'Hair stylists', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('812115', 'CA', 'Barber shops', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('812116', 'CA', 'Unisex hair salons', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('812199', 'CA', 'Other personal care services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('812910', 'CA', 'Pet care (except veterinary) services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('236110', 'US', 'Residential building construction', 'New single-family + multi-family + remodeling', '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('236210', 'US', 'Industrial building construction', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('236220', 'US', 'Commercial and institutional building construction', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('238100', 'US', 'Foundation, structure, and building exterior contractors', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('238210', 'US', 'Electrical contractors and other wiring installation', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('238220', 'US', 'Plumbing, heating and air-conditioning contractors', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('238910', 'US', 'Site preparation contractors', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('441100', 'US', 'Automobile dealers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('441200', 'US', 'Other motor vehicle dealers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('441300', 'US', 'Automotive parts, accessories and tire stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('445110', 'US', 'Supermarkets and grocery stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('445120', 'US', 'Convenience stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('445230', 'US', 'Fruit and vegetable markets', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('445299', 'US', 'All other specialty food stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('445310', 'US', 'Beer, wine and liquor stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('446110', 'US', 'Pharmacies and drug stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('448110', 'US', 'Men''s clothing stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('448120', 'US', 'Women''s clothing stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('448140', 'US', 'Family clothing stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('451110', 'US', 'Sporting goods stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('453110', 'US', 'Florists', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('453910', 'US', 'Pet and pet supplies stores', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('484110', 'US', 'General freight trucking, local', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('484121', 'US', 'General freight trucking, long distance, truckload', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('484229', 'US', 'Other specialized trucking, local', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('492110', 'US', 'Couriers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('492210', 'US', 'Local messengers and local delivery', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('522110', 'US', 'Banking', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('523930', 'US', 'Investment advice', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('524210', 'US', 'Insurance agencies and brokerages', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('531110', 'US', 'Lessors of residential buildings and dwellings', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('531210', 'US', 'Offices of real estate agents and brokers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('531311', 'US', 'Residential property managers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541110', 'US', 'Offices of lawyers', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541211', 'US', 'Offices of certified public accountants', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541310', 'US', 'Architectural services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541330', 'US', 'Engineering services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541430', 'US', 'Graphic design services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541510', 'US', 'Computer systems design and related services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541611', 'US', 'Administrative management and general management consulting', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541810', 'US', 'Advertising agencies', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('541910', 'US', 'Marketing research and public opinion polling', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('561320', 'US', 'Temporary help services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('561720', 'US', 'Janitorial services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('611110', 'US', 'Elementary and secondary schools', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621111', 'US', 'Offices of physicians (except mental health specialists)', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621210', 'US', 'Offices of dentists', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621310', 'US', 'Offices of chiropractors', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621320', 'US', 'Offices of optometrists', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621399', 'US', 'Offices of all other miscellaneous health practitioners', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('621610', 'US', 'Home health care services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('722410', 'US', 'Drinking places (alcoholic beverages)', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('722511', 'US', 'Full-service restaurants', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('722512', 'US', 'Limited-service eating places', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('722513', 'US', 'Limited-service eating places (counter service)', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('811111', 'US', 'General automotive repair', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('811121', 'US', 'Automotive body, paint and interior repair and maintenance', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('811210', 'US', 'Electronic and precision equipment repair and maintenance', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('812114', 'US', 'Hair stylists', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('812115', 'US', 'Barber shops', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('812116', 'US', 'Unisex hair salons', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('812199', 'US', 'Other personal care services', NULL, '2026-05-11 18:05:39.741434+00');
INSERT INTO public.naics_codes VALUES ('812910', 'US', 'Pet care (except veterinary) services', NULL, '2026-05-11 18:05:39.741434+00');


--
-- PostgreSQL database dump complete
--

\unrestrict 6O5aluPdzvlRouPDIpVErLwwjnNLaUhvEiDt49gjgwuTkZd1Mzt9CvGLroTvicx

