import json, copy
s = json.load(open('spec.json'))
tmpl = s['componentTree'][0]
def comp(id, name, level, parent, primitive, topo, dims, pos, material, role, feats=(), contact='overlap', importance=0.7, anim='static-child'):
    c = copy.deepcopy(tmpl)
    c.update(id=id, name=name, level=level, role=role, importance=importance, confidence=0.75, primitive=primitive,
             topologyClass=topo, topologyRationale=f'{name}: continuous organic volume read from the reference; ' + ('one closed smooth solid' if topo=='smooth-organic' else 'assembled from joined solids'),
             parent=parent, material=material, materialLayers=[material], fidelityTier='form')
    c['attachment'] = None if parent is None else {'parentSocket': parent, 'contactType': contact, 'embedDepth': 0.03, 'notes': f'{name} overlaps its parent by 2-4 cm; never floating'}
    c['dimensions'] = {'width': dims[0], 'height': dims[1], 'depth': dims[2], 'units': 'm', 'confidence': 0.7}
    c['transform']['position'] = pos
    c['actionProfile']['animationRole'] = anim
    c['actionProfile']['pivot']['localPosition'] = pos
    c['actionProfile']['collider']['type'] = 'sphere' if primitive in ('ellipsoid', 'sphere') else 'capsule'
    c['actionProfile']['destruction']['fractureGroup'] = id
    c['actionProfile']['destruction']['debrisMaterial'] = material
    c['localFeatures'] = [{'id': f, 'description': f, 'evidenceRef': 'full-object'} for f in feats]
    c['geometryDescriptor']['topologyIntent'] = 'icosphere detail 2 blended masses; flat-shaded by the game bake'
    return c
T = [
 comp('root','Baby Dragon','macro',None,'group','assembled-solid',[1.6,2.6,2.8],[0,0,0],'skin','body',importance=1.0,anim='root'),
 comp('body','Obese torso (belly, chest, rump, haunches)','macro','root','ellipsoid','smooth-organic',[1.6,1.6,1.9],[0,1.0,0],'skin','body',['belly-lighter-low-contrast','no-waist-blend-into-neck'],importance=1.0,anim='joint:body'),
 comp('neck','Thick neck continuous with head (neck1, neck2)','meso','body','ellipsoid','smooth-organic',[1.04,0.96,1.0],[0,0.75,0.45],'skin','neck',['neck-width-equals-head'],anim='joint:neck1'),
 comp('head','Head: cranium + long forward snout','macro','neck','ellipsoid','smooth-organic',[1.0,0.92,1.6],[0,0.35,0.45],'skin','head',['snout-length-0.9x-body-width','nostrils-on-snout-top','brow-ridge'],importance=1.0,anim='joint:head'),
 comp('eyes','Eyes high/back on head, heavy upper lid','micro','head','sphere','assembled-solid',[0.26,0.28,0.24],[0.3,0.42,0.28],'eye-white','sense',['brown-iris','black-pupil','green-lid'],importance=0.8),
 comp('ears','Brown ear flaps at top-back of head','meso','head','cone','assembled-solid',[0.2,0.28,0.1],[0.28,0.55,-0.15],'horn','ornament',['point-back-up-out']),
 comp('mouth','Open mouth: cavity, upper teeth row','meso','head','ellipsoid','assembled-solid',[0.72,0.36,1.1],[0,-0.12,0.5],'mouth','mouth',['gape-runs-full-snout-length','upper-teeth-6-per-side']),
 comp('jaw','Lower jaw opened ~0.3 rad with lower teeth','meso','head','ellipsoid','smooth-organic',[0.76,0.26,1.2],[0,-0.12,0.05],'skin','jaw',['lower-teeth-4-per-side'],anim='joint:jaw'),
 comp('tongue','Broad flat tongue lolling out and down','meso','jaw','sweep','smooth-organic',[0.26,0.9,0.6],[0.12,-0.2,0.6],'tongue','tongue',['flattened-across-x']),
 comp('wings','Small bat wings high on back','macro','body','triangles','thin-shell',[1.0,0.6,0.7],[0.35,0.7,-0.2],'wing','wing',['three-finger-bones','membrane-scallops'],anim='joint:wingL/wingTipL'),
 comp('arms','Stubby chubby arms held forward, 4 fingers','meso','body','capsule','smooth-organic',[0.4,0.5,0.5],[0.55,0.25,0.55],'skin','limb',['brown-fingertips'],anim='joint:legFL/shinFL'),
 comp('legs','Short fat hind legs dangling back, 3 toes','meso','body','capsule','smooth-organic',[0.4,0.5,0.5],[0.5,-0.55,-0.15],'skin','limb',['brown-toes'],anim='joint:legBL/shinBL'),
 comp('tail','Short thick tail curling up to a point','meso','body','sweep','smooth-organic',[0.76,0.4,1.0],[0,-0.2,-0.9],'skin','tail',['tapers-to-point'],anim='joint:tail1-4'),
]
s['componentTree'] = T
base = s['materials'][0]
def m(id, name, color, sec, rough):
    x = copy.deepcopy(base); x.update(id=id, name=name, baseColor=color, color=color, notes='albedo estimated from reference with lighting removed; flat colour (game bakes vertex colours, no textures)')
    x['albedo'] = {'dominant': color, 'secondary': sec, 'samplingNotes': 'estimated from lit regions of the reference, highlights and shadow ignored'}
    x['colorVariation'] = {'palette': [color]+sec, 'pattern': 'none', 'amplitude': 0.0, 'heightCorrelation': 0.0}
    x['roughness']['base'] = rough
    return x
s['materials'] = [m('skin','Lime green skin','#8cc540',['#a8d45a','#6aa332'],0.8), m('horn','Brown ears/fingertips/toes','#9b5a3c',['#b07a5a'],0.85),
  m('wing','Brown wing membrane','#a8603a',['#c9803f','#8a4a2a'],0.85), m('mouth','Mouth cavity','#5a2a22',[],0.9), m('tongue','Tongue','#b8675a',[],0.7),
  m('teeth','Teeth','#ece8dc',[],0.5), m('eye-white','Eye sclera/iris/pupil','#f6f3ea',['#7a4a20','#1a120a'],0.4)]
s['materials'][0]['localOverrides'] = [{'id':'belly-lighter','region':'belly front','color':'#a8d45a','note':'low-contrast lighter belly, not a cream patch'}]
s['featureReviewTargets'] = [
 {'id':'snout-and-grin','name':'Long forward snout with huge open grin, teeth top and bottom','tier':'critical','passIds':['blockout','form-refinement'],'minimumScore':0.75,'mustPass':True,'componentRefs':['head','mouth','jaw'],'evidenceRefs':['full-object']},
 {'id':'obese-body','name':'Obese round body continuous with head, no waist','tier':'critical','passIds':['blockout'],'minimumScore':0.75,'mustPass':True,'componentRefs':['body','neck'],'evidenceRefs':['full-object']},
 {'id':'lolling-tongue','name':'Broad flat tongue hanging out','tier':'critical','passIds':['form-refinement'],'minimumScore':0.7,'mustPass':True,'componentRefs':['tongue'],'evidenceRefs':['full-object']},
 {'id':'small-wings','name':'Small brown bat wings high on back','tier':'critical','passIds':['blockout'],'minimumScore':0.7,'mustPass':True,'componentRefs':['wings'],'evidenceRefs':['full-object']},
 {'id':'eyes-ears','name':'Small lidded eyes high/back, brown ear flaps','tier':'critical','passIds':['form-refinement'],'minimumScore':0.7,'mustPass':True,'componentRefs':['eyes','ears'],'evidenceRefs':['full-object']},
 {'id':'limbs-tail','name':'Stubby forward arms, dangling legs, short up-curled tail','tier':'important','passIds':['form-refinement'],'minimumScore':0.6,'mustPass':False,'componentRefs':['arms','legs','tail'],'evidenceRefs':['full-object']},
 {'id':'palette','name':'Lime green + warm brown palette','tier':'important','passIds':['material-pass'],'minimumScore':0.6,'mustPass':False,'componentRefs':['root'],'evidenceRefs':['full-object']},
]
p = s['preSpecAssessment']
p['objectClass'].update(primaryType='stylised cartoon baby dragon creature', primaryDomain='character', formLanguage=['organic','rounded','chubby'], structureKind=['articulated creature'], motionPotential=['flying','breath attack'], materialFamilies=['skin','keratin','membrane'], notes='Clash of Clans Baby Dragon style; non-humanoid; flight pose')
p['complexity']['estimatedCounts'] = {'macroComponents':4,'mesoComponents':7,'microFeatureGroups':1,'materialLayers':7,'repetitionSystems':2}
p['complexity']['scores'] = {k:3 for k in p['complexity']['scores']}
p['complexity']['reasoning'] = ['one continuous organic mass with 9 attached sub-assemblies and two repetition systems (teeth, fingers/toes)']
p['unknownsToResolveBeforeImplementation'] = ['model right side hidden: mirrored from left','wing back surface hidden: same brown','teeth count approximate at 379 px']
p['detailInventory']['details'] = [{'id':f['id'],'componentRef':c['id'],'description':f['description']} for c in T for f in c['localFeatures']]
s['repetitionSystems'] = [{'id':'teeth','componentRef':'mouth','count':20,'pattern':'arc along jaw rims','notes':'6 upper + 4 lower per side, blunt cones'},{'id':'digits','componentRef':'arms','count':14,'pattern':'4 fingers per hand, 3 toes per foot','notes':'brown caps'}]
s['silhouette'] = {'boundingShape':'forward-leaning ovoid with elongated head lobe','aspectRatios':[{'name':'length:height','value':1.1}],'symmetry':'bilateral','dominantCurves':['belly arc','snout top line'],'negativeSpaces':['open mouth gape','gap under arms'],'landmarks':['snout tip','wing tips','tail tip','feet']}
s['coordinateFrame'] = {'front':'+Z (snout direction)','up':'+Y','left':'+X is the model own left','scaleReference':'metres; game unit height 2.4, lowest point on y=0'}
s['assumptions'] = ['Implementation target is the game factory createBabyDragonModel in src/game/models/dragon.ts: it must keep the dragon rig joint names (body, neck1, neck2, head, jaw, tail1-4, wingL/R, wingTipL/R, legFL/R, shinFL/R, legBL/R, shinBL/R, socket mouth) and the game bake (flat-shaded vertex colours). The generic factory generator output is not used as the shipping code; the spec stays the reconstruction authority.','Arms are authored pre-rotated so the flight animation (legF +0.7, shinF +0.9 rad) holds them forward.']
s['risks'] = ['flat shading cannot reproduce smooth CGI shading','single view: right side inferred by mirroring']
s['performanceBudget'].update(targetTriangles=6000, maxDrawCalls=1, textureSize=0, fpsTarget=60)
s['lightingFromPhoto'] = [{'type':'key','direction':'upper-front-left','notes':'soft studio light; ignored for albedo'}]
json.dump(s, open('spec.json','w'), indent=1, ensure_ascii=False)
print('ok', len(T))
s = json.load(open('spec.json'))
prim = {'root':'ellipsoid','tongue':'tapered-sweep','tail':'tapered-sweep','wings':'plane-card'}
kinds = {'belly-lighter-low-contrast':'contour','no-waist-blend-into-neck':'contour','neck-width-equals-head':'contour','snout-length-0.9x-body-width':'contour','nostrils-on-snout-top':'hole','brow-ridge':'ridge','brown-iris':'decal','black-pupil':'decal','green-lid':'ridge','point-back-up-out':'contour','gape-runs-full-snout-length':'contour','upper-teeth-6-per-side':'ridge','lower-teeth-4-per-side':'ridge','flattened-across-x':'contour','three-finger-bones':'ridge','membrane-scallops':'contour','brown-fingertips':'decal','brown-toes':'decal','tapers-to-point':'contour'}
for c in s['componentTree']:
    if c['id'] in prim: c['primitive'] = prim[c['id']]
    if c['id'] == 'root': c['topologyRationale'] = 'Root pivot group; its bound is the forward-leaning ovoid silhouette'
    if c['id'] == 'mouth':
        c.update(id='mouth', name='Upper teeth row and dark mouth lining', role='dentition')
        c['topologyRationale'] = 'The gape itself is real negative space: the jaw joint is rotated open so snout and lower jaw are physically apart; this component is only the dark lining solid behind that opening plus the upper teeth row'
    if c['id'] == 'wings': c['topologyClass'] = 'thin-shell'
dets = []
for c in s['componentTree']:
    for f in c['localFeatures']:
        dets.append({'id': f['id'], 'kind': kinds[f['id']], 'zone': c['id'], 'description': f['description'], 'mapsTo': {'type': 'localFeature', 'ref': f"{c['id']}/{f['id']}"}})
s['preSpecAssessment']['detailInventory']['details'] = dets
s['preSpecAssessment']['anatomy'].update(applies=True, styleHeads=2.8, proportions={'headUnit':0.92,'torso':1.6,'legs':0.5,'shoulderWidth':1.1,'hipWidth':1.3},
  pose={'type':'flight, body pitched forward ~25 deg, arms forward, legs dangling back','jointAngles':{'legF':0.7,'shinF':0.9,'legB':0.9,'shinB':0.6}},
  faceLandmarks={'eyeLine':0.46,'eyeSpacing':0.6,'noseBase':0.3,'mouthLine':-0.08,'hairline':0.0}, features=['long snout','open grin','ear flaps'], confidence=0.7,
  note='Non-humanoid creature: head-unit measured by eye from the reference, values in metres of the game model')
json.dump(s, open('spec.json','w'), indent=1, ensure_ascii=False)
print('fixed')
