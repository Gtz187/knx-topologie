# Erzeugt kleine Test-Projekte im ETS-Format (.knxproj).
import zipfile, sys

HW = '''<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/21"><ManufacturerData><Manufacturer RefId="M-0083"><Hardware>
<Hardware Id="M-0083_H-1" Name="LK" IsCoupler="true"><Products><Product Id="M-0083_H-1-P-1" Text="Linienkoppler REG"/></Products></Hardware>
<Hardware Id="M-0083_H-2" Name="SV" IsPowerSupply="true" HasIndividualAddress="false"><Products><Product Id="M-0083_H-2-P-1" Text="Spannungsversorgung 640 mA"/></Products></Hardware>
<Hardware Id="M-0083_H-3" Name="SA"><Products><Product Id="M-0083_H-3-P-1" Text="Schaltaktor 8-fach"/></Products></Hardware>
<Hardware Id="M-0083_H-4" Name="T"><Products><Product Id="M-0083_H-4-P-1" Text="Tastsensor 4-fach"/></Products></Hardware>
<Hardware Id="M-0083_H-5" Name="IPR" IsCoupler="true" IsIPEnabled="true"><Products><Product Id="M-0083_H-5-P-1" Text="KNX IP Router"/></Products></Hardware>
<Hardware Id="M-0083_H-6" Name="LV" IsCoupler="true"><Products><Product Id="M-0083_H-6-P-1" Text="Linienverstärker"/></Products></Hardware>
<Hardware Id="M-0083_H-7" Name="RFT"><Products><Product Id="M-0083_H-7-P-1" Text="Funk-Taster"/></Products></Hardware>
</Hardware></Manufacturer></ManufacturerData></KNX>'''

def dev(addr, prod, name='', links=None, conn=None):
    a = f' Address="{addr}"' if addr is not None else ''
    co = ''
    if links:
        co = '<ComObjectInstanceRefs>' + ''.join(f'<ComObjectInstanceRef RefId="O-{i}_R-{i}" Links="{l}"/>' for i, l in enumerate(links)) + '</ComObjectInstanceRefs>'
    if conn:
        co = '<ComObjectInstanceRefs>' + ''.join(
            f'<ComObjectInstanceRef RefId="O-{i}_R-{i}"><Connectors>' + ''.join(f'<{k} GroupAddressRefId="P-0001-0_{g}"/>' for k, g in c) + '</Connectors></ComObjectInstanceRef>'
            for i, c in enumerate(conn)) + '</ComObjectInstanceRefs>'
    return f'<DeviceInstance Id="P-0001-0_DI-{addr}-{prod}"{a} Name="{name}" ProductRefId="M-0083_H-{prod}-P-1">{co}</DeviceInstance>'

GAS = '''<GroupAddresses><GroupRanges><GroupRange Name="Licht" RangeStart="0" RangeEnd="2047"><GroupRange Name="Schalten" RangeStart="0" RangeEnd="255">
<GroupAddress Id="P-0001-0_GA-1" Address="1" Name="Licht Küche"/>
<GroupAddress Id="P-0001-0_GA-2" Address="2" Name="Licht Bad"/>
<GroupAddress Id="P-0001-0_GA-3" Address="2305" Name="Licht Garten"/>
</GroupRange></GroupRange></GroupRanges></GroupAddresses>'''

def project(style):
    L = (lambda *x: dict(links=list(x))) if style == 'ets6' else (lambda *x: dict(conn=[[('Send', x[0])] + [('Receive', g) for g in x[1:]]]))
    topo = f'''<Topology>
<Area Id="P-0001-0_A-0" Address="0" Name="Backbone"><Line Id="P-0001-0_L-0" Address="0" Name="Bereichslinie" MediumTypeRefId="MT-5"/></Area>
<Area Id="P-0001-0_A-1" Address="1" Name="Haus">
 <Line Id="P-0001-0_L-1" Address="0" Name="Hauptlinie" MediumTypeRefId="MT-0">{dev(0, 5, 'IP-Router Haus')}{dev(None, 2)}</Line>
 <Line Id="P-0001-0_L-2" Address="1" Name="Erdgeschoss" MediumTypeRefId="MT-0">
  {dev(0, 1)}{dev(None, 2)}{dev(1, 3, 'Aktor EG', **L('GA-1', 'GA-2'))}{dev(2, 4, 'Taster Küche', **L('GA-1'))}
  {dev(64, 6)}{dev(None, 2, 'SV Segment 2')}{dev(65, 4, 'Taster Bad', **L('GA-2'))}
 </Line>
 <Line Id="P-0001-0_L-3" Address="2" Name="Garten Funk" MediumTypeRefId="MT-2">{dev(0, 1, 'Medienkoppler')}{dev(1, 7, '', **L('GA-3'))}{dev(2, 3, 'Funkaktor Garten', **L('GA-3'))}</Line>
</Area>
<Area Id="P-0001-0_A-2" Address="2" Name="Garage"><Line Id="P-0001-0_L-4" Address="0" MediumTypeRefId="MT-0"/>
 <Line Id="P-0001-0_L-5" Address="1" Name="Garage" MediumTypeRefId="MT-0">{dev(None, 2)}{dev(1, 3, 'Aktor Garage', **L('GA-3'))}</Line>
</Area></Topology>'''
    return f'''<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/21"><Project Id="P-0001"><Installations><Installation Name="Testhaus">{topo}{GAS}</Installation></Installations></Project></KNX>'''

PROJ = '''<?xml version="1.0" encoding="utf-8"?><KNX><Project Id="P-0001"><ProjectInformation Name="Testhaus &amp; Garten"/></Project></KNX>'''

for style in ('ets6', 'ets5'):
    with zipfile.ZipFile(f'{sys.argv[1]}/{style}.knxproj', 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('knx_master.xml', '<KNX/>')
        z.writestr('M-0083/Hardware.xml', HW)
        z.writestr('P-0001/project.xml', PROJ)
        z.writestr('P-0001/0.xml', project(style))
