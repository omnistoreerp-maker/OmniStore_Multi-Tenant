#!/usr/bin/env python3
"""
Vercel Deployment Script for DigiTronics ERP
Usage: python deploy-to-vercel.py --token YOUR_VERCEL_TOKEN
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
import zipfile
import io

def get_project(token, project_name='digitronics'):
    """Find Vercel project by name"""
    req = urllib.request.Request(
        'https://api.vercel.com/v9/projects',
        headers={'Authorization': f'Bearer {token}'}
    )
    try:
        response = urllib.request.urlopen(req)
        data = json.loads(response.read().decode())
        for proj in data.get('projects', []):
            if project_name.lower() in proj.get('name', '').lower():
                return proj
        return None
    except Exception as e:
        print(f"Error finding project: {e}")
        return None

def create_deployment(token, project_id, team_id=None):
    """Create a new deployment"""
    # First, we need to upload files
    # This is simplified - full implementation would upload each file
    print("Creating deployment...")
    
    url = f'https://api.vercel.com/v13/deployments'
    if team_id:
        url += f'?teamId={team_id}'
    
    payload = {
        'name': 'digitronics',
        'project': project_id,
        'target': 'production',
        'routes': [
            {'src': '/(.*)', 'dest': '/index.html'}
        ]
    }
    
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
    )
    
    try:
        response = urllib.request.urlopen(req)
        data = json.loads(response.read().decode())
        return data
    except Exception as e:
        print(f"Error creating deployment: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description='Deploy DigiTronics to Vercel')
    parser.add_argument('--token', required=True, help='Vercel API token')
    parser.add_argument('--project', default='digitronics', help='Project name')
    args = parser.parse_args()
    
    print(f"Looking for project '{args.project}'...")
    project = get_project(args.token, args.project)
    
    if not project:
        print(f"Project '{args.project}' not found!")
        print("Available projects:")
        req = urllib.request.Request(
            'https://api.vercel.com/v9/projects',
            headers={'Authorization': f'Bearer {args.token}'}
        )
        try:
            response = urllib.request.urlopen(req)
            data = json.loads(response.read().decode())
            for p in data.get('projects', [])[:10]:
                print(f"  - {p['name']}")
        except:
            pass
        sys.exit(1)
    
    print(f"Found project: {project['name']} (ID: {project['id']})")
    
    # Note: Full deployment requires file uploads which is complex
    # This script shows the structure but actual deployment needs
    # individual file uploads to Vercel's file API
    print("\nTo deploy, please use one of these methods:")
    print("1. Vercel CLI: npx vercel --prod")
    print("2. Vercel Dashboard: https://vercel.com/dashboard")
    print("3. GitHub integration (push to repo)")

if __name__ == '__main__':
    main()
